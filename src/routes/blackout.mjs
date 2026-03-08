import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireApiKey } from '../middleware/auth.mjs';
import { requireSession } from '../middleware/session.mjs';
async function requireAuth(req, reply) {
  if (req.headers['x-api-key']) return requireApiKey(req, reply);
  return requireSession(req, reply);
}

export default async function blackoutRoutes(fastify) {

  // List blackout dates
  fastify.get('/blackout', {
    preHandler: requireAuth,
    schema: {
      tags: ['Blackout Dates'],
      summary: 'List blackout dates',
      description: 'Returns all blocked dates/ranges for the authenticated user.',
      security: [{ apiKey: [] }],
    },
  }, async (req) => {
    const result = await db.find(tables.blocked_times, `(user_id,eq,${req.user.Id})`);
    return { blackout: result.list || [] };
  });

  // Add blackout date
  fastify.post('/blackout', {
    preHandler: requireAuth,
    schema: {
      tags: ['Blackout Dates'],
      summary: 'Add a blackout date or range',
      description: 'Block out a full day or a specific time window. Bookings will not be available during blackout periods.',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['date'],
        properties: {
          date: { type: 'string', format: 'date', description: 'The date to block out (YYYY-MM-DD)' },
          end_date: { type: 'string', format: 'date', description: 'Optional end date for a multi-day range (YYYY-MM-DD). If omitted, blocks the single `date` only.' },
          start_time: { type: 'string', description: 'Optional start time for partial-day blocks (HH:MM). Omit for full-day block.' },
          end_time: { type: 'string', description: 'Optional end time for partial-day blocks (HH:MM).' },
          reason: { type: 'string', description: 'Internal note (not shown to attendees)' },
        },
      },
    },
  }, async (req, reply) => {
    const { date, end_date, start_time, end_time, reason } = req.body;

    // Build start/end datetimes
    const startDt = start_time
      ? new Date(`${date}T${start_time}:00`).toISOString()
      : new Date(`${date}T00:00:00`).toISOString();

    const endDate = end_date || date;
    const endDt = end_time
      ? new Date(`${endDate}T${end_time}:00`).toISOString()
      : new Date(`${endDate}T23:59:59`).toISOString();

    const row = await db.create(tables.blocked_times, {
      user_id: String(req.user.Id),
      start_time: startDt,
      end_time: endDt,
      reason: reason || '',
      created_at: new Date().toISOString(),
    });

    return reply.code(201).send(row);
  });

  // Delete blackout date
  fastify.delete('/blackout/:id', {
    preHandler: requireAuth,
    schema: {
      tags: ['Blackout Dates'],
      summary: 'Remove a blackout date',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const existing = await db.get(tables.blocked_times, req.params.id);
    if (!existing || existing.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });
    await db.delete(tables.blocked_times, req.params.id);
    return { deleted: true };
  });
}
