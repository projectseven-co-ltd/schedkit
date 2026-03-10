import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireApiKey } from '../middleware/auth.mjs';
import { requireSession } from '../middleware/session.mjs';

async function requireAuth(req, reply) {
  if (req.headers['x-api-key']) return requireApiKey(req, reply);
  return requireSession(req, reply);
}

const eventTypeSchema = {
  type: 'object',
  properties: {
    Id: { type: 'integer' },
    title: { type: 'string' },
    slug: { type: 'string' },
    description: { type: 'string' },
    appointment_label: { type: 'string', description: 'Custom noun shown to attendees — "appointment", "inspection", "session", etc.' },
    duration_minutes: { type: 'integer' },
    buffer_before: { type: 'integer' },
    buffer_after: { type: 'integer' },
    min_notice_minutes: { type: 'integer', description: 'Minimum advance notice required to book (minutes)' },
    max_bookings_per_day: { type: 'integer' },
    location: { type: 'string' },
    location_type: { type: 'string', enum: ['video', 'phone', 'in_person', 'other'] },
    webhook_url: { type: 'string' },
    custom_fields: { type: 'string', description: 'JSON array of custom field definitions' },
    requires_confirmation: { type: 'boolean', description: 'Require host to confirm each booking before it is finalized' },
    active: { type: 'boolean' },
  },
};

export default async function eventTypesRoutes(fastify) {

  fastify.get('/event-types', {
    preHandler: requireAuth,
    schema: {
      tags: ['Event Types'],
      summary: 'List event types',
      security: [{ apiKey: [] }],
      response: { 200: { type: 'object', properties: { event_types: { type: 'array', items: eventTypeSchema } } } },
    },
  }, async (req) => {
    const result = await db.find(tables.event_types, `(user_id,eq,${req.user.Id})`);
    return { event_types: result.list || [] };
  });

  fastify.get('/event-types/:id', {
    preHandler: requireAuth,
    schema: {
      tags: ['Event Types'],
      summary: 'Get event type',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const row = await db.get(tables.event_types, req.params.id);
    if (!row || row.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });
    return row;
  });

  fastify.post('/event-types', {
    preHandler: requireAuth,
    schema: {
      tags: ['Event Types'],
      summary: 'Create event type',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['title', 'slug', 'duration_minutes'],
        properties: {
          title: { type: 'string' },
          slug: { type: 'string' },
          description: { type: 'string' },
          appointment_label: { type: 'string', default: 'meeting' },
          duration_minutes: { type: 'integer' },
          buffer_before: { type: 'integer', default: 0 },
          buffer_after: { type: 'integer', default: 0 },
          min_notice_minutes: { type: 'integer', default: 0 },
          max_bookings_per_day: { type: 'integer' },
          location: { type: 'string' },
          location_type: { type: 'string', enum: ['video', 'phone', 'in_person', 'other'] },
          webhook_url: { type: 'string' },
          custom_fields: { type: 'string', description: 'JSON array of custom field definitions' },
        },
      },
    },
  }, async (req, reply) => {
    const { title, slug, description, appointment_label, duration_minutes,
            buffer_before, buffer_after, min_notice_minutes,
            max_bookings_per_day, location, location_type, webhook_url, custom_fields, requires_confirmation } = req.body;

    if (!title || !slug || !duration_minutes) {
      return reply.code(400).send({ error: 'title, slug, duration_minutes required' });
    }

    const row = await db.create(tables.event_types, {
      user_id: String(req.user.Id),
      title, slug, description,
      appointment_label: appointment_label || 'meeting',
      duration_minutes: Number(duration_minutes),
      buffer_before: Number(buffer_before || 0),
      buffer_after: Number(buffer_after || 0),
      min_notice_minutes: Number(min_notice_minutes || 0),
      max_bookings_per_day: max_bookings_per_day ? Number(max_bookings_per_day) : null,
      location, location_type, webhook_url,
      custom_fields: custom_fields || '[]',
      requires_confirmation: !!requires_confirmation,
      active: true,
      created_at: new Date().toISOString(),
    });

    return reply.code(201).send(row);
  });

  fastify.patch('/event-types/:id', {
    preHandler: requireAuth,
    schema: {
      tags: ['Event Types'],
      summary: 'Update event type',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: { type: 'object', properties: eventTypeSchema.properties },
    },
  }, async (req, reply) => {
    const existing = await db.get(tables.event_types, req.params.id);
    if (!existing || existing.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });
    const updated = await db.update(tables.event_types, req.params.id, req.body);
    return updated;
  });

  fastify.delete('/event-types/:id', {
    preHandler: requireAuth,
    schema: {
      tags: ['Event Types'],
      summary: 'Delete event type',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const existing = await db.get(tables.event_types, req.params.id);
    if (!existing || existing.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });
    await db.delete(tables.event_types, req.params.id);
    return { deleted: true };
  });
}
