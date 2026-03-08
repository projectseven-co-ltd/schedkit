import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireApiKey } from '../middleware/auth.mjs';
import { requireSession } from '../middleware/session.mjs';
import { getSlots } from '../lib/availability.mjs';

// Accept either API key or session cookie
async function requireAuth(req, reply) {
  if (req.headers['x-api-key']) return requireApiKey(req, reply);
  return requireSession(req, reply);
}

export default async function availabilityRoutes(fastify) {

  fastify.get('/availability', {
    preHandler: requireAuth,
    schema: { tags: ['Availability'], summary: 'List availability rules', security: [{ apiKey: [] }] },
  }, async (req) => {
    const result = await db.find(tables.availability, `(user_id,eq,${req.user.Id})`);
    return { availability: result.list || [] };
  });

  fastify.post('/availability', {
    preHandler: requireAuth,
    schema: {
      tags: ['Availability'], summary: 'Create availability rule', security: [{ apiKey: [] }],
      body: {
        type: 'object', required: ['day_of_week', 'start_time', 'end_time'],
        properties: {
          day_of_week: { type: 'integer', description: '0=Sunday, 6=Saturday' },
          start_time: { type: 'string', description: 'HH:MM' },
          end_time: { type: 'string', description: 'HH:MM' },
          timezone: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { day_of_week, start_time, end_time, timezone } = req.body;
    if (day_of_week === undefined || !start_time || !end_time)
      return reply.code(400).send({ error: 'day_of_week, start_time, end_time required' });
    const row = await db.create(tables.availability, {
      user_id: String(req.user.Id),
      day_of_week: Number(day_of_week),
      start_time, end_time,
      timezone: timezone || req.user.timezone || 'UTC',
    });
    return reply.code(201).send(row);
  });

  fastify.put('/availability', {
    preHandler: requireAuth,
    schema: { tags: ['Availability'], summary: 'Set availability for a day (replaces existing)', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const { day_of_week, start_time, end_time, timezone } = req.body;
    if (day_of_week === undefined || !start_time || !end_time)
      return reply.code(400).send({ error: 'day_of_week, start_time, end_time required' });
    const existing = await db.find(tables.availability, `(user_id,eq,${req.user.Id})~and(day_of_week,eq,${day_of_week})`);
    for (const row of existing.list || []) await db.delete(tables.availability, row.Id);
    const row = await db.create(tables.availability, {
      user_id: String(req.user.Id),
      day_of_week: Number(day_of_week),
      start_time, end_time,
      timezone: timezone || req.user.timezone || 'UTC',
    });
    return row;
  });

  fastify.patch('/availability/:id', {
    preHandler: requireAuth,
    schema: { tags: ['Availability'], summary: 'Update an availability rule by ID', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const existing = await db.get(tables.availability, req.params.id);
    if (!existing || existing.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });
    return await db.update(tables.availability, req.params.id, req.body);
  });

  fastify.delete('/availability/:id', {
    preHandler: requireAuth,
    schema: { tags: ['Availability'], summary: 'Delete an availability rule by ID', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const existing = await db.get(tables.availability, req.params.id);
    if (!existing || existing.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });
    await db.delete(tables.availability, req.params.id);
    return { deleted: true };
  });

  // PUBLIC: Get available slots
  fastify.get('/slots/:username/:event_slug', {
    schema: {
      tags: ['Public'],
      summary: 'Get available slots for a date',
      params: { type: 'object', properties: { username: { type: 'string' }, event_slug: { type: 'string' } } },
      querystring: {
        type: 'object', required: ['date'],
        properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, timezone: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const { username, event_slug } = req.params;
    const { date, timezone = 'UTC' } = req.query;
    if (!date) return reply.code(400).send({ error: 'date query param required (YYYY-MM-DD)' });

    const userResult = await db.find(tables.users, `(slug,eq,${username})`);
    if (!userResult.list?.length) return reply.code(404).send({ error: 'User not found' });
    const user = userResult.list[0];

    const etResult = await db.find(tables.event_types, `(user_id,eq,${user.Id})~and(slug,eq,${event_slug})~and(active,eq,true)`);
    if (!etResult.list?.length) return reply.code(404).send({ error: 'Event type not found' });

    const slots = await getSlots(user.Id, etResult.list[0], date, timezone);
    return { date, timezone, event_type: { title: etResult.list[0].title, duration_minutes: etResult.list[0].duration_minutes }, slots };
  });
}
