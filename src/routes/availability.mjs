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

const availabilityExample = {
  Id: 12,
  user_id: '7',
  day_of_week: 1,
  start_time: '09:00',
  end_time: '17:00',
  timezone: 'America/Chicago',
};

export default async function availabilityRoutes(fastify) {

  fastify.get('/availability', {
    preHandler: requireAuth,
    schema: {
      tags: ['Availability'],
      summary: 'List availability rules',
      description: 'Return the weekly availability windows for the authenticated user. These rules drive public slot generation.',
      security: [{ apiKey: [] }],
      response: {
        200: {
          type: 'object',
          properties: { availability: { type: 'array', items: { type: 'object', additionalProperties: true } } },
          example: { availability: [availabilityExample] },
        },
      },
    },
  }, async (req) => {
    const result = await db.find(tables.availability, `(user_id,eq,${req.user.Id})`);
    return { availability: result.list || [] };
  });

  fastify.post('/availability', {
    preHandler: requireAuth,
    schema: {
      tags: ['Availability'], summary: 'Create availability rule', security: [{ apiKey: [] }],
      description: 'Create a single weekly availability window for the authenticated user.',
      body: {
        type: 'object', required: ['day_of_week', 'start_time', 'end_time'],
        properties: {
          day_of_week: { type: 'integer', description: '0=Sunday, 6=Saturday' },
          start_time: { type: 'string', description: 'HH:MM' },
          end_time: { type: 'string', description: 'HH:MM' },
          timezone: { type: 'string' },
        },
        examples: [{ day_of_week: 1, start_time: '09:00', end_time: '17:00', timezone: 'America/Chicago' }],
      },
      response: { 201: { type: 'object', additionalProperties: true, example: availabilityExample } },
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
    schema: {
      tags: ['Availability'],
      summary: 'Set availability for a day (replaces existing)',
      description: 'Replace all availability rules for a given day with a single new window.',
      security: [{ apiKey: [] }],
      body: {
        type: 'object', required: ['day_of_week', 'start_time', 'end_time'],
        properties: {
          day_of_week: { type: 'integer' },
          start_time: { type: 'string' },
          end_time: { type: 'string' },
          timezone: { type: 'string' },
        },
        examples: [{ day_of_week: 2, start_time: '10:00', end_time: '16:00', timezone: 'America/Chicago' }],
      },
      response: { 200: { type: 'object', additionalProperties: true, example: { ...availabilityExample, day_of_week: 2, start_time: '10:00', end_time: '16:00' } } },
    },
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
    schema: {
      tags: ['Availability'],
      summary: 'Update an availability rule by ID',
      description: 'Patch a single availability rule without replacing other rules for the same day.',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          day_of_week: { type: 'integer' },
          start_time: { type: 'string' },
          end_time: { type: 'string' },
          timezone: { type: 'string' },
        },
        examples: [{ start_time: '08:30', end_time: '15:30' }],
      },
      response: { 200: { type: 'object', additionalProperties: true, example: { ...availabilityExample, start_time: '08:30', end_time: '15:30' } } },
    },
  }, async (req, reply) => {
    const existing = await db.get(tables.availability, req.params.id);
    if (!existing || existing.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });
    return await db.update(tables.availability, req.params.id, req.body);
  });

  fastify.delete('/availability/:id', {
    preHandler: requireAuth,
    schema: {
      tags: ['Availability'],
      summary: 'Delete an availability rule by ID',
      description: 'Delete a single availability rule for the authenticated user.',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      response: { 200: { type: 'object', properties: { deleted: { type: 'boolean' } }, example: { deleted: true } } },
    },
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
      description: 'Return bookable slots for a public event type on a specific date in the requested timezone.',
      params: { type: 'object', properties: { username: { type: 'string' }, event_slug: { type: 'string' } } },
      querystring: {
        type: 'object', required: ['date'],
        properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, timezone: { type: 'string' } },
        examples: [{ date: '2026-03-20', timezone: 'America/Chicago' }],
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          example: {
            date: '2026-03-20',
            timezone: 'America/Chicago',
            event_type: {
              title: 'Incident Triage',
              duration_minutes: 30,
              appointment_label: 'assignment',
              location_type: 'video',
              location: 'Google Meet',
              custom_fields: '[]',
              description: 'Quick ops intake call',
            },
            slots: ['2026-03-20T14:00:00.000Z', '2026-03-20T14:30:00.000Z'],
          },
        },
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
    return {
      date, timezone,
      event_type: {
        title: etResult.list[0].title,
        duration_minutes: etResult.list[0].duration_minutes,
        appointment_label: etResult.list[0].appointment_label || 'meeting',
        location_type: etResult.list[0].location_type || null,
        location: etResult.list[0].location || null,
        custom_fields: etResult.list[0].custom_fields || null,
        description: etResult.list[0].description || null,
      },
      slots
    };
  });
}
