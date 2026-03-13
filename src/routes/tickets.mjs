// src/routes/tickets.mjs — Ticketing API

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireApiKey } from '../middleware/auth.mjs';
import { requireSession } from '../middleware/session.mjs';

async function requireAuth(req, reply) {
  if (req.headers['x-api-key']) return requireApiKey(req, reply);
  return requireSession(req, reply);
}

// SLA window in hours by priority
const SLA_HOURS = { urgent: 1, high: 4, normal: 24, low: 48 };

function calcSlaDueAt(priority) {
  const hours = SLA_HOURS[priority] ?? 24;
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

function slaStatus(ticket) {
  const { sla_due_at, sla_breached, status, priority } = ticket;
  if (!sla_due_at) return 'ok';
  const resolved = status === 'resolved' || status === 'closed';
  if (resolved) return sla_breached ? 'breached' : 'ok';

  const now = Date.now();
  const due = new Date(sla_due_at).getTime();
  if (sla_breached || now >= due) return 'breached';

  const hours = SLA_HOURS[priority] ?? 24;
  const windowMs = hours * 3600 * 1000;
  const remaining = due - now;
  if (remaining / windowMs <= 0.2) return 'warning';
  return 'ok';
}

function withSlaStatus(ticket) {
  return { ...ticket, sla_status: slaStatus(ticket) };
}

export default async function ticketsRoutes(fastify) {
  // GET /v1/tickets — list tickets for authenticated user
  fastify.get('/tickets', {
    preHandler: requireAuth,
    schema: {
      tags: ['Tickets'],
      summary: 'List tickets',
      description: 'Returns tickets for the authenticated user. Filter by `status` (`open`, `in_progress`, `resolved`, `closed`) or `priority` (`low`, `normal`, `high`, `urgent`). Paginated.',
      security: [{ apiKey: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'closed'], description: 'Filter by ticket status' },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], description: 'Filter by priority' },
          limit: { type: 'integer', default: 50 },
          page: { type: 'integer', default: 1 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            tickets: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sla_due_at: { type: 'string', nullable: true, description: 'ISO datetime when SLA is due' },
                  sla_breached: { type: 'boolean', description: 'Whether SLA has been breached' },
                  sla_status: { type: 'string', enum: ['ok', 'warning', 'breached'], description: 'Computed SLA status' },
                },
              },
            },
            total: { type: 'integer' },
          },
        },
      },
    },
  }, async (req) => {
    const { status, priority, limit = 50, page = 1 } = req.query;
    let where = `(user_id,eq,${req.user.Id})`;
    if (status) where += `~and(status,eq,${status})`;
    if (priority) where += `~and(priority,eq,${priority})`;

    const result = await db.list(tables.tickets, {
      where,
      limit,
      offset: (page - 1) * limit,
      sort: '-CreatedAt',
    });
    const tickets = (result.list || []).map(withSlaStatus);
    return { tickets, total: result.pageInfo?.totalRows || 0 };
  });

  // POST /v1/tickets — create ticket
  fastify.post('/tickets', {
    preHandler: requireAuth,
    schema: {
      tags: ['Tickets'],
      summary: 'Create ticket',
      description: 'Creates a new support ticket for the authenticated user. `title` is required. Defaults: `status=open`, `priority=normal`, `source=api`.',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', description: 'Ticket title (required)' },
          description: { type: 'string', description: 'Detailed description' },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
          source: { type: 'string', enum: ['api', 'email', 'webhook', 'alert'], default: 'api', description: 'Origin of the ticket' },
          source_ref: { type: 'string', description: 'External reference ID (e.g. email message ID)' },
        },
      },
    },
  }, async (req, reply) => {
    const { title, description, priority = 'normal', source = 'api', source_ref } = req.body;

    const ticket = await db.create(tables.tickets, {
      title,
      description: description || '',
      status: 'open',
      priority,
      user_id: req.user.Id,
      source,
      source_ref: source_ref || null,
      sla_due_at: calcSlaDueAt(priority),
      sla_breached: false,
    });

    return reply.code(201).send(withSlaStatus(ticket));
  });

  // GET /v1/tickets/:id — get single ticket
  fastify.get('/tickets/:id', {
    preHandler: requireAuth,
    schema: {
      tags: ['Tickets'],
      summary: 'Get ticket',
      description: 'Returns a single ticket by ID. Only accessible by the owning user.',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            sla_due_at: { type: 'string', nullable: true, description: 'ISO datetime when SLA is due' },
            sla_breached: { type: 'boolean', description: 'Whether SLA has been breached' },
            sla_status: { type: 'string', enum: ['ok', 'warning', 'breached'], description: 'Computed SLA status' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const row = await db.get(tables.tickets, req.params.id);
    if (!row || row.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });
    return withSlaStatus(row);
  });

  // PATCH /v1/tickets/:id — update ticket
  fastify.patch('/tickets/:id', {
    preHandler: requireAuth,
    schema: {
      tags: ['Tickets'],
      summary: 'Update ticket',
      description: 'Update a ticket\'s status, priority, assignee, title, or description. Only accessible by the owning user.',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'closed'] },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
          assignee_id: { type: 'integer', nullable: true, description: 'User ID of the assignee' },
        },
      },
    },
  }, async (req, reply) => {
    const existing = await db.get(tables.tickets, req.params.id);
    if (!existing || existing.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });

    const { title, description, status, priority, assignee_id } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (priority !== undefined) updates.priority = priority;
    if (assignee_id !== undefined) updates.assignee_id = assignee_id;

    if (!Object.keys(updates).length) return reply.code(400).send({ error: 'No fields to update' });

    // SLA breach check: only if not resolving/closing
    const newStatus = status ?? existing.status;
    const isTerminal = newStatus === 'resolved' || newStatus === 'closed';
    if (!isTerminal) {
      const due = existing.sla_due_at ? new Date(existing.sla_due_at).getTime() : null;
      if (due && Date.now() >= due) {
        updates.sla_breached = true;
      }
    }
    // Never set sla_breached when resolving/closing

    await db.update(tables.tickets, existing.Id, updates);
    const updated = await db.get(tables.tickets, existing.Id);
    return withSlaStatus(updated);
  });

  // DELETE /v1/tickets/:id — close ticket (soft close, don't delete)
  fastify.delete('/tickets/:id', {
    preHandler: requireAuth,
    schema: {
      tags: ['Tickets'],
      summary: 'Close ticket',
      description: 'Closes a ticket by setting its status to `closed`. Does not delete the record. Only accessible by the owning user.',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const existing = await db.get(tables.tickets, req.params.id);
    if (!existing || existing.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });
    if (existing.status === 'closed') return reply.code(400).send({ error: 'Ticket is already closed' });

    await db.update(tables.tickets, existing.Id, { status: 'closed' });
    return { ok: true, status: 'closed', id: existing.Id };
  });
}
