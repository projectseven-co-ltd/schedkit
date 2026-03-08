// src/routes/eventTypes.js

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireApiKey } from '../middleware/auth.mjs';

export default async function eventTypesRoutes(fastify) {
  // List event types
  fastify.get('/event-types', { preHandler: requireApiKey }, async (req, reply) => {
    const result = await db.find(tables.event_types, `(user_id,eq,${req.user.Id})`);
    return { event_types: result.list || [] };
  });

  // Get single
  fastify.get('/event-types/:id', { preHandler: requireApiKey }, async (req, reply) => {
    const row = await db.get(tables.event_types, req.params.id);
    if (!row || row.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });
    return row;
  });

  // Create
  fastify.post('/event-types', { preHandler: requireApiKey }, async (req, reply) => {
    const { title, slug, description, duration_minutes, buffer_before, buffer_after,
            max_bookings_per_day, location, location_type, webhook_url } = req.body;

    if (!title || !slug || !duration_minutes) {
      return reply.code(400).send({ error: 'title, slug, duration_minutes required' });
    }

    const row = await db.create(tables.event_types, {
      user_id: String(req.user.Id),
      title, slug, description,
      duration_minutes: Number(duration_minutes),
      buffer_before: Number(buffer_before || 0),
      buffer_after: Number(buffer_after || 0),
      max_bookings_per_day: max_bookings_per_day ? Number(max_bookings_per_day) : null,
      location, location_type, webhook_url,
      active: true,
      created_at: new Date().toISOString(),
    });

    return reply.code(201).send(row);
  });

  // Update
  fastify.patch('/event-types/:id', { preHandler: requireApiKey }, async (req, reply) => {
    const existing = await db.get(tables.event_types, req.params.id);
    if (!existing || existing.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });

    const updated = await db.update(tables.event_types, req.params.id, req.body);
    return updated;
  });

  // Delete
  fastify.delete('/event-types/:id', { preHandler: requireApiKey }, async (req, reply) => {
    const existing = await db.get(tables.event_types, req.params.id);
    if (!existing || existing.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });

    await db.delete(tables.event_types, req.params.id);
    return { deleted: true };
  });
}
