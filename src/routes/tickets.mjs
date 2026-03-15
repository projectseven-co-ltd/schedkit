// src/routes/tickets.mjs — Ticketing / Incident API
//
// Tickets and incidents are the SAME object in the same NocoDB table.
// /v1/tickets and /v1/incidents operate on identical records — no separate table.
// The "incidents" routes add a real-time layer (SSE, responders, replies) on top.
// Use /v1/tickets for helpdesk/ITSM flows. Use /v1/incidents + SSE for dispatch/ops flows.
// The `source` field (api/email/webhook/alert) and `priority` together imply context.
// Neither endpoint enforces a use case on the caller.

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireApiKey } from '../middleware/auth.mjs';
import { requireSession } from '../middleware/session.mjs';
import { nanoid } from 'nanoid';

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

// Lazy broadcast — imported after module init to avoid circular issues
async function tryBroadcast(type, payload) {
  try {
    const { broadcastAll } = await import('./incidents.mjs');
    broadcastAll({ type, payload });
  } catch {}
}

async function tryPush(userId, opts) {
  try {
    const { sendPushToUser } = await import('./push.mjs');
    await sendPushToUser(userId, opts);
  } catch {}
}

async function tryNtfy(title, message, priority = 'default') {
  try {
    const topic = process.env.NTFY_DEFAULT_TOPIC || process.env.NTFY_TOPIC || 'schedkit-leads';
    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: {
        'Title': title,
        'Priority': priority,
        'Tags': 'schedkit,incident',
        'Content-Type': 'text/plain',
      },
      body: message,
    });
  } catch {}
}

async function tryUserNtfy(userId, title, description, priority, source) {
  try {
    const { db: ntfyDb } = await import('../lib/noco.mjs');
    const { tables: ntfyTables } = await import('../lib/tables.mjs');
    const user = await ntfyDb.get(ntfyTables.users, userId);
    const topic = user?.ntfy_topic?.trim();
    if (!topic) return;
    const ntfyPriority = priority === 'urgent' ? 'urgent' : priority === 'high' ? 'high' : 'default';
    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: {
        'Title': title,
        'Priority': ntfyPriority,
        'Tags': source || 'incident',
        'Content-Type': 'text/plain',
      },
      body: (description || '').slice(0, 200),
    });
  } catch {}
}

const UNIFIED_DESCRIPTION = `
**Tickets and incidents are the same object.** Every record in this table is accessible via both \`/v1/tickets\` and the real-time \`/v1/incidents\` layer — same NocoDB row, same ID, same fields. No data is duplicated.

- Use \`/v1/tickets\` for helpdesk, ITSM, or async workflows
- Use \`/v1/incidents\` + SSE for real-time dispatch, ops war rooms, or alert routing
- The \`source\` field (\`api\`, \`email\`, \`webhook\`, \`alert\`) and \`priority\` together imply context — neither endpoint enforces a use case on the caller
`;

const ticketExample = {
  Id: 42,
  title: 'Water main pressure drop',
  description: 'Pressure dropped below threshold at Site Alpha.',
  status: 'open',
  priority: 'urgent',
  source: 'alert',
  source_ref: 'sensor-ops-991',
  user_id: 7,
  sla_due_at: '2026-03-15T19:00:00Z',
  sla_breached: false,
  sla_status: 'warning',
  customer_token: 'cus_tok_abc123xyz',
  customer_status_url: 'https://schedkit.net/incidents/status/cus_tok_abc123xyz',
  lat: 35.4676,
  lng: -97.5164,
  location_name: 'Site Alpha',
};

export default async function ticketsRoutes(fastify) {
  // GET /v1/tickets — list tickets for authenticated user
  fastify.get('/tickets', {
    preHandler: requireAuth,
    schema: {
      tags: ['Tickets'],
      summary: 'List tickets / incidents',
      description: UNIFIED_DESCRIPTION + '\nReturns records for the authenticated user. Filter by `status` or `priority`. Paginated.',
      security: [{ apiKey: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'closed'], description: 'Filter by status' },
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
                additionalProperties: true,
                properties: {
                  sla_due_at: { type: 'string', nullable: true },
                  sla_breached: { type: 'boolean' },
                  sla_status: { type: 'string', enum: ['ok', 'warning', 'breached'] },
                  customer_token: { type: 'string', description: 'Magic token for public customer status page' },
                },
              },
            },
            total: { type: 'integer' },
          },
          example: { tickets: [ticketExample], total: 1 },
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

  // POST /v1/tickets — create ticket / incident
  fastify.post('/tickets', {
    preHandler: requireAuth,
    schema: {
      tags: ['Tickets'],
      summary: 'Create ticket / incident',
      description: UNIFIED_DESCRIPTION + '\nCreates a new record. `title` is required. Defaults: `status=open`, `priority=normal`, `source=api`. A `customer_token` is generated automatically — use it to share the public status page at `https://schedkit.net/incidents/status/:token`. A real-time SSE event (`incident.created`) is broadcast to all connected staff.',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
          source: { type: 'string', enum: ['api', 'email', 'webhook', 'alert'], default: 'api', description: 'Origin of the record. Use `alert` for automated incident creation, `email` for inbound support, `api` for programmatic creation.' },
          source_ref: { type: 'string', description: 'External reference ID (e.g. email message ID, alert ID)' },
          lat: { type: 'number', nullable: true, description: 'Incident latitude' },
          lng: { type: 'number', nullable: true, description: 'Incident longitude' },
          location_name: { type: 'string', nullable: true, description: 'Human-readable location name' },
        },
        examples: [{
          title: 'Water main pressure drop',
          description: 'Pressure dropped below threshold at Site Alpha.',
          priority: 'urgent',
          source: 'alert',
          source_ref: 'sensor-ops-991',
          lat: 35.4676,
          lng: -97.5164,
          location_name: 'Site Alpha',
        }],
      },
      response: {
        201: {
          type: 'object',
          additionalProperties: true,
          description: 'Created ticket/incident',
          properties: {
            Id: { type: 'integer' },
            title: { type: 'string' },
            status: { type: 'string' },
            priority: { type: 'string' },
            sla_due_at: { type: 'string', nullable: true },
            sla_breached: { type: 'boolean' },
            sla_status: { type: 'string', enum: ['ok', 'warning', 'breached'] },
            customer_token: { type: 'string', description: 'Magic token for the public customer status page' },
            customer_status_url: { type: 'string', description: 'Full URL to public customer status page' },
            lat: { type: 'number', nullable: true },
            lng: { type: 'number', nullable: true },
            location_name: { type: 'string', nullable: true },
          },
          example: ticketExample,
        },
      },
    },
  }, async (req, reply) => {
    const { title, description, priority = 'normal', source = 'api', source_ref, lat, lng, location_name } = req.body;
    const customer_token = nanoid(24);

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
      customer_token,
      lat: lat ?? null,
      lng: lng ?? null,
      location_name: location_name ?? null,
    });

    const result = withSlaStatus({
      ...ticket,
      customer_status_url: `https://schedkit.net/incidents/status/${customer_token}`,
    });

    // SSE broadcast
    tryBroadcast('incident.created', result);

    // Web push + ntfy for urgent/high or alert source
    if (priority === 'urgent' || priority === 'high' || source === 'alert') {
      tryUserNtfy(req.user.Id, title, description, priority, source);
      tryNtfy(
        `[!] New incident: ${title}`,
        `Priority: ${priority.toUpperCase()}\nSource: ${source}\n${description || ''}`,
        priority === 'urgent' ? 'urgent' : 'high'
      );
      tryPush(req.user.Id, {
        title: `[!] ${priority.toUpperCase()} — ${title}`,
        body: description || `New ${source} incident`,
        url: '/dashboard',
        tag: `incident-${ticket.Id}`,
        requireInteraction: priority === 'urgent',
      });
    }

    return reply.code(201).send(result);
  });

  // GET /v1/tickets/:id — get single ticket/incident
  fastify.get('/tickets/:id', {
    preHandler: requireAuth,
    schema: {
      tags: ['Tickets'],
      summary: 'Get ticket / incident',
      description: UNIFIED_DESCRIPTION + '\nReturns a single record by ID.',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            sla_due_at: { type: 'string', nullable: true },
            sla_breached: { type: 'boolean' },
            sla_status: { type: 'string', enum: ['ok', 'warning', 'breached'] },
            customer_token: { type: 'string' },
            customer_status_url: { type: 'string' },
          },
          example: ticketExample,
        },
      },
    },
  }, async (req, reply) => {
    const row = await db.get(tables.tickets, req.params.id);
    if (!row || row.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });
    return {
      ...withSlaStatus(row),
      customer_status_url: row.customer_token
        ? `https://schedkit.net/incidents/status/${row.customer_token}`
        : null,
    };
  });

  // PATCH /v1/tickets/:id — update ticket/incident
  fastify.patch('/tickets/:id', {
    preHandler: requireAuth,
    schema: {
      tags: ['Tickets'],
      summary: 'Update ticket / incident',
      description: UNIFIED_DESCRIPTION + '\nUpdate status, priority, assignee, title, or description. Broadcasts `incident.updated` (or `incident.resolved`) to all connected SSE clients.',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'closed'] },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
          assignee_id: { type: 'integer', nullable: true },
          lat: { type: 'number', nullable: true },
          lng: { type: 'number', nullable: true },
          location_name: { type: 'string', nullable: true },
        },
        examples: [{ status: 'in_progress', priority: 'high', assignee_id: 12, location_name: 'Site Alpha North Gate' }],
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          example: { ...ticketExample, status: 'in_progress', priority: 'high', assignee_id: 12, location_name: 'Site Alpha North Gate' },
        },
      },
    },
  }, async (req, reply) => {
    const existing = await db.get(tables.tickets, req.params.id);
    if (!existing || existing.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });

    const { title, description, status, priority, assignee_id, lat, lng, location_name } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (priority !== undefined) updates.priority = priority;
    if (assignee_id !== undefined) updates.assignee_id = assignee_id;
    if (lat !== undefined) updates.lat = lat;
    if (lng !== undefined) updates.lng = lng;
    if (location_name !== undefined) updates.location_name = location_name;

    if (!Object.keys(updates).length) return reply.code(400).send({ error: 'No fields to update' });

    const newStatus = status ?? existing.status;
    const isTerminal = newStatus === 'resolved' || newStatus === 'closed';
    if (!isTerminal) {
      const due = existing.sla_due_at ? new Date(existing.sla_due_at).getTime() : null;
      if (due && Date.now() >= due) {
        updates.sla_breached = true;
      }
    }

    await db.update(tables.tickets, existing.Id, updates);
    const updated = await db.get(tables.tickets, existing.Id);
    const result = {
      ...withSlaStatus(updated),
      customer_status_url: updated.customer_token
        ? `https://schedkit.net/incidents/status/${updated.customer_token}`
        : null,
    };

    // Check if SLA just breached
    if (updates.sla_breached && !existing.sla_breached) {
      tryBroadcast('incident.breached', result);
      tryNtfy(
        `[!] SLA breached: ${updated.title}`,
        `Priority: ${(updated.priority || 'normal').toUpperCase()}\nTicket #${updated.Id}`,
        'urgent'
      );
      tryPush(existing.user_id, {
        title: `[!] SLA Breached`,
        body: `${updated.title} — response time exceeded`,
        url: '/dashboard',
        tag: `sla-${updated.Id}`,
        requireInteraction: true,
      });
    } else if (isTerminal) {
      tryBroadcast('incident.resolved', result);
    } else {
      tryBroadcast('incident.updated', result);
    }

    return result;
  });

  // DELETE /v1/tickets/:id — close ticket (soft)
  fastify.delete('/tickets/:id', {
    preHandler: requireAuth,
    schema: {
      tags: ['Tickets'],
      summary: 'Close ticket / incident',
      description: 'Sets status to `closed`. Does not delete the record. Broadcasts `incident.resolved` to SSE clients.',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            status: { type: 'string' },
            id: { type: 'integer' },
          },
          example: { ok: true, status: 'closed', id: 42 },
        },
      },
    },
  }, async (req, reply) => {
    const existing = await db.get(tables.tickets, req.params.id);
    if (!existing || existing.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });
    if (existing.status === 'closed') return reply.code(400).send({ error: 'Ticket is already closed' });

    await db.update(tables.tickets, existing.Id, { status: 'closed' });
    tryBroadcast('incident.resolved', { ...existing, status: 'closed' });
    return { ok: true, status: 'closed', id: existing.Id };
  });
}
