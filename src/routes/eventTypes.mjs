import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireApiKey } from '../middleware/auth.mjs';
import { requireSession } from '../middleware/session.mjs';
import { getLimits, planError } from './planLimits.mjs';

async function requireAuth(req, reply) {
  if (req.headers['x-api-key']) return requireApiKey(req, reply);
  return requireSession(req, reply);
}

const eventTypeExample = {
  Id: 14,
  title: 'Incident Triage',
  slug: 'incident-triage',
  description: 'Quick ops intake for new incidents.',
  appointment_label: 'assignment',
  duration_minutes: 30,
  buffer_before: 0,
  buffer_after: 15,
  min_notice_minutes: 60,
  max_bookings_per_day: 8,
  location: 'Google Meet',
  location_type: 'video',
  webhook_url: 'https://example.com/hooks/bookings',
  custom_fields: '[{"id":"site","label":"Site","type":"text"}]',
  requires_confirmation: false,
  active: true,
};

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
      description: 'Returns all event types for the authenticated user. Each event type has a public booking URL at `/book/:username/:slug`.',
      security: [{ apiKey: [] }],
      response: { 200: { type: 'object', properties: { event_types: { type: 'array', items: eventTypeSchema } }, example: { event_types: [eventTypeExample] } } },
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
      description: 'Return a single event type definition by ID for the authenticated user.',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      response: { 200: { ...eventTypeSchema, example: eventTypeExample } },
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
      description: 'Create a new bookable event type. The `slug` is used in the public booking URL (`/book/:username/:slug`). Set `requires_confirmation: true` to put new bookings in a **pending** state — you will receive an email with one-click confirm/decline links, and the attendee is notified their request is under review.',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['title', 'duration_minutes'],
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
          webhook_url: { type: 'string', description: 'POST this URL when a booking is created for this event type' },
          custom_fields: { type: 'string', description: 'JSON array of custom field definitions shown on the booking form' },
          requires_confirmation: { type: 'boolean', description: 'If true, new bookings are held as `pending` until the host confirms or declines via email link or dashboard' },
        },
        examples: [eventTypeExample],
      },
      response: { 201: { ...eventTypeSchema, example: eventTypeExample } },
    },
  }, async (req, reply) => {
    const { title, slug: rawSlug, description, appointment_label, duration_minutes,
            buffer_before, buffer_after, min_notice_minutes,
            max_bookings_per_day, location, location_type, webhook_url, custom_fields, requires_confirmation } = req.body;

    if (!title || !duration_minutes) {
      return reply.code(400).send({ error: 'title and duration_minutes are required' });
    }

    // Auto-generate slug from title if not provided
    const slug = (rawSlug || title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // Check for slug conflict
    const conflict = await db.find(tables.event_types, `(user_id,eq,${req.user.Id})~and(slug,eq,${slug})`);
    if (conflict.list?.length) {
      return reply.code(409).send({ error: `You already have an event type with the slug "${slug}". Try a different title or slug.` });
    }

    // Plan enforcement
    const plan = req.user.plan || 'free';
    const limits = getLimits(plan);
    if (limits.event_types !== Infinity) {
      const existing = await db.find(tables.event_types, `(user_id,eq,${req.user.Id})`);
      const count = (existing.list || []).length;
      if (count >= limits.event_types) {
        return reply.code(403).send(planError('event types', limits.event_types, count));
      }
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
      description: 'Partially update an event type. Only fields included in the request body are changed. Toggle `requires_confirmation` here to switch between instant-confirm and host-approval flows.',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: { type: 'object', properties: eventTypeSchema.properties, examples: [{ title: 'Urgent Dispatch', duration_minutes: 45, requires_confirmation: true }] },
      response: { 200: { ...eventTypeSchema, example: { ...eventTypeExample, title: 'Urgent Dispatch', duration_minutes: 45, requires_confirmation: true } } },
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
      description: 'Delete an event type owned by the authenticated user.',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      response: { 200: { type: 'object', properties: { deleted: { type: 'boolean' } }, example: { deleted: true } } },
    },
  }, async (req, reply) => {
    const existing = await db.get(tables.event_types, req.params.id);
    if (!existing || existing.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });
    await db.delete(tables.event_types, req.params.id);
    return { deleted: true };
  });
}
