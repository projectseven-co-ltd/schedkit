// src/routes/availability.js

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireApiKey } from '../middleware/auth.mjs';
import { getSlots } from '../lib/availability.mjs';

export default async function availabilityRoutes(fastify) {
  // Get availability rules
  fastify.get('/availability', { preHandler: requireApiKey }, async (req) => {
    const result = await db.find(tables.availability, `(user_id,eq,${req.user.Id})`);
    return { availability: result.list || [] };
  });

  // Set availability (replace all for a day)
  fastify.put('/availability', { preHandler: requireApiKey }, async (req, reply) => {
    const { day_of_week, start_time, end_time, timezone } = req.body;
    if (day_of_week === undefined || !start_time || !end_time) {
      return reply.code(400).send({ error: 'day_of_week, start_time, end_time required' });
    }

    // Delete existing for this day
    const existing = await db.find(
      tables.availability,
      `(user_id,eq,${req.user.Id})~and(day_of_week,eq,${day_of_week})`
    );
    for (const row of existing.list || []) {
      await db.delete(tables.availability, row.Id);
    }

    const row = await db.create(tables.availability, {
      user_id: String(req.user.Id),
      day_of_week: Number(day_of_week),
      start_time, end_time,
      timezone: timezone || req.user.timezone || 'UTC',
    });

    return row;
  });

  // Delete availability for a day
  fastify.delete('/availability/:day', { preHandler: requireApiKey }, async (req, reply) => {
    const existing = await db.find(
      tables.availability,
      `(user_id,eq,${req.user.Id})~and(day_of_week,eq,${req.params.day})`
    );
    for (const row of existing.list || []) {
      await db.delete(tables.availability, row.Id);
    }
    return { deleted: true };
  });

  // PUBLIC: Get available slots for an event type on a date
  // GET /slots/:username/:event_slug?date=YYYY-MM-DD&timezone=America/Chicago
  fastify.get('/slots/:username/:event_slug', async (req, reply) => {
    const { username, event_slug } = req.params;
    const { date, timezone = 'UTC' } = req.query;

    if (!date) return reply.code(400).send({ error: 'date query param required (YYYY-MM-DD)' });

    const userResult = await db.find(tables.users, `(slug,eq,${username})`);
    if (!userResult.list?.length) return reply.code(404).send({ error: 'User not found' });
    const user = userResult.list[0];

    const etResult = await db.find(
      tables.event_types,
      `(user_id,eq,${user.Id})~and(slug,eq,${event_slug})~and(active,eq,true)`
    );
    if (!etResult.list?.length) return reply.code(404).send({ error: 'Event type not found' });
    const eventType = etResult.list[0];

    const slots = await getSlots(user.Id, eventType, date, timezone);

    return {
      date,
      timezone,
      event_type: { title: eventType.title, duration_minutes: eventType.duration_minutes },
      slots,
    };
  });
}
