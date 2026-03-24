// src/routes/alerts.mjs — Alerts API
//
// An alert is an inbound signal that demands attention and (optionally) creates a ticket.
// Severity: info | warning | critical
// Status:   firing | acked | resolved
//
// Sources: api | webhook | sensor | noaa | booking | scheduled
//
// Flow:
//   POST /v1/alerts         — fire an alert (creates record, broadcasts SSE, optionally creates ticket)
//   GET  /v1/alerts         — list alerts (filterable by status/severity)
//   GET  /v1/alerts/:id     — get single alert
//   PATCH /v1/alerts/:id    — ack or resolve
//   DELETE /v1/alerts/:id   — hard delete (admin / cleanup)
//   GET  /v1/alerts/stream  — SSE stream of live alert events

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireApiKey } from '../middleware/auth.mjs';
import { requireSession } from '../middleware/session.mjs';

async function requireAuth(req, reply) {
  if (req.headers['x-api-key']) return requireApiKey(req, reply);
  return requireSession(req, reply);
}

// ── SSE clients ───────────────────────────────────────
// Map: userId (string) → Set of reply objects
// Alerts are user-scoped (or org-scoped in future)
const alertClients = new Map();

export function broadcastAlert(userId, event) {
  const clients = alertClients.get(String(userId));
  if (!clients) return;
  const data = 'data: ' + JSON.stringify(event) + '\n\n';
  for (const reply of clients) {
    try { reply.raw.write(data); } catch { clients.delete(reply); }
  }
}

// Also broadcast to all connected clients (used for org-wide alerts)
export function broadcastAlertAll(event) {
  const data = 'data: ' + JSON.stringify(event) + '\n\n';
  for (const clients of alertClients.values()) {
    for (const reply of clients) {
      try { reply.raw.write(data); } catch { clients.delete(reply); }
    }
  }
}

// ── Helpers ───────────────────────────────────────────

async function tryPush(userId, opts) {
  try {
    const { sendPushToUser } = await import('./push.mjs');
    await sendPushToUser(userId, opts);
  } catch {}
}

async function tryNtfy(userId, title, body, severity) {
  try {
    const user = await db.get(tables.users, userId);
    const topic = user?.ntfy_topic?.trim();
    if (!topic) return;
    const priority = severity === 'critical' ? 'urgent' : severity === 'warning' ? 'high' : 'default';
    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: {
        'Title': title,
        'Priority': priority,
        'Tags': 'schedkit,alert',
        'Content-Type': 'text/plain',
      },
      body: (body || '').slice(0, 300),
    });
  } catch {}
}

// Optionally auto-create a ticket from an alert
async function maybeCreateTicket(alert, user) {
  if (alert.severity !== 'critical') return null;
  try {
    const { nanoid } = await import('nanoid');
    const customer_token = nanoid(24);
    const ticket = await db.create(tables.tickets, {
      title: alert.title,
      description: alert.body || '',
      status: 'open',
      priority: 'urgent',
      user_id: alert.user_id,
      source: 'alert',
      source_ref: `alert-${alert.Id}`,
      sla_due_at: new Date(Date.now() + 3600 * 1000).toISOString(), // 1h SLA for critical
      sla_breached: false,
      customer_token,
      lat: alert.lat ?? null,
      lng: alert.lng ?? null,
      location_name: alert.location_name ?? null,
      org_id: alert.org_id ?? null,
    });
    // Link ticket back to alert
    await db.update(tables.alerts, alert.Id, { ticket_id: ticket.Id });
    // Broadcast new incident
    try {
      const { broadcastAll } = await import('./incidents.mjs');
      broadcastAll({ type: 'incident.created', payload: { ...ticket, customer_status_url: `https://schedkit.net/incidents/status/${customer_token}` } });
    } catch {}
    return ticket;
  } catch (e) {
    return null;
  }
}

// ── Route schema examples ─────────────────────────────

const alertExample = {
  Id: 1,
  title: 'Pressure sensor offline',
  body: 'Sensor unit-7 at Site Alpha has not reported in 5 minutes.',
  severity: 'critical',
  source: 'sensor',
  source_ref: 'sensor-unit-7',
  status: 'firing',
  user_id: 1,
  org_id: 3,
  ticket_id: null,
  lat: 35.4676,
  lng: -97.5164,
  location_name: 'Site Alpha',
  meta: null,
  fired_at: '2026-03-24T12:00:00Z',
  acked_at: null,
  resolved_at: null,
};

// ── Routes ────────────────────────────────────────────

export default async function alertsRoutes(fastify) {

  // POST /v1/alerts — fire a new alert
  fastify.post('/alerts', {
    preHandler: requireAuth,
    schema: {
      tags: ['Alerts'],
      summary: 'Fire an alert',
      description: 'Create a new alert. `critical` severity automatically creates an incident ticket with a 1h SLA and broadcasts to all SSE clients. All alerts trigger push + ntfy notifications if the user has a topic configured.',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['title'],
        properties: {
          title:         { type: 'string' },
          body:          { type: 'string' },
          severity:      { type: 'string', enum: ['info', 'warning', 'critical'], default: 'warning' },
          source:        { type: 'string', enum: ['api', 'webhook', 'sensor', 'noaa', 'booking', 'scheduled'], default: 'api' },
          source_ref:    { type: 'string', description: 'External reference (sensor ID, webhook ID, etc.)' },
          org_id:        { type: 'integer', nullable: true },
          lat:           { type: 'number', nullable: true },
          lng:           { type: 'number', nullable: true },
          location_name: { type: 'string', nullable: true },
          meta:          { type: 'object', additionalProperties: true, nullable: true },
        },
        examples: [{
          title: 'Pressure sensor offline',
          body: 'Sensor unit-7 at Site Alpha has not reported in 5 minutes.',
          severity: 'critical',
          source: 'sensor',
          source_ref: 'sensor-unit-7',
          lat: 35.4676,
          lng: -97.5164,
          location_name: 'Site Alpha',
        }],
      },
      response: {
        201: {
          type: 'object',
          additionalProperties: true,
          example: alertExample,
        },
      },
    },
  }, async (req, reply) => {
    const {
      title, body, severity = 'warning', source = 'api', source_ref,
      org_id, lat, lng, location_name, meta,
    } = req.body;

    const alert = await db.create(tables.alerts, {
      title,
      body: body || '',
      severity,
      source,
      source_ref: source_ref || null,
      status: 'firing',
      user_id: req.user.Id,
      org_id: org_id || null,
      ticket_id: null,
      lat: lat ?? null,
      lng: lng ?? null,
      location_name: location_name ?? null,
      meta: meta ? JSON.stringify(meta) : null,
      fired_at: new Date().toISOString(),
      acked_at: null,
      resolved_at: null,
    });

    // Auto-create ticket for critical alerts
    if (severity === 'critical') {
      maybeCreateTicket(alert, req.user); // fire-and-forget, ticket_id linked async
    }

    // SSE broadcast
    broadcastAlert(req.user.Id, { type: 'alert.fired', payload: alert });
    if (org_id) {
      // Also broadcast to any org members who are connected
      broadcastAlertAll({ type: 'alert.fired', payload: alert });
    }

    // Notifications
    const notifTitle = `[${severity.toUpperCase()}] ${title}`;
    tryNtfy(req.user.Id, notifTitle, body, severity);
    if (severity === 'critical' || severity === 'warning') {
      tryPush(req.user.Id, {
        title: notifTitle,
        body: body || `${source} alert fired`,
        url: '/dashboard#signals',
        tag: `alert-${alert.Id}`,
        requireInteraction: severity === 'critical',
      });
    }

    return reply.code(201).send(alert);
  });

  // GET /v1/alerts — list alerts
  fastify.get('/alerts', {
    preHandler: requireAuth,
    schema: {
      tags: ['Alerts'],
      summary: 'List alerts',
      description: 'Returns alerts for the authenticated user, newest first. Filter by `status` or `severity`.',
      security: [{ apiKey: [] }],
      querystring: {
        type: 'object',
        properties: {
          status:   { type: 'string', enum: ['firing', 'acked', 'resolved'] },
          severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
          limit:    { type: 'integer', default: 50 },
          page:     { type: 'integer', default: 1 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            alerts: { type: 'array', items: { type: 'object', additionalProperties: true } },
            total:  { type: 'integer' },
          },
          example: { alerts: [alertExample], total: 1 },
        },
      },
    },
  }, async (req) => {
    const { status, severity, limit = 50, page = 1 } = req.query;
    let where = `(user_id,eq,${req.user.Id})`;
    if (status)   where += `~and(status,eq,${status})`;
    if (severity) where += `~and(severity,eq,${severity})`;

    const result = await db.list(tables.alerts, {
      where,
      limit,
      offset: (page - 1) * limit,
      sort: '-fired_at',
    });
    return { alerts: result.list || [], total: result.pageInfo?.totalRows || 0 };
  });

  // GET /v1/alerts/:id — get single alert
  fastify.get('/alerts/:id', {
    preHandler: requireAuth,
    schema: {
      tags: ['Alerts'],
      summary: 'Get alert',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true, example: alertExample } },
    },
  }, async (req, reply) => {
    const row = await db.get(tables.alerts, req.params.id);
    if (!row || row.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });
    return row;
  });

  // PATCH /v1/alerts/:id — ack or resolve
  fastify.patch('/alerts/:id', {
    preHandler: requireAuth,
    schema: {
      tags: ['Alerts'],
      summary: 'Acknowledge or resolve an alert',
      description: 'Set status to `acked` or `resolved`. Timestamps `acked_at` / `resolved_at` automatically. Broadcasts `alert.acked` or `alert.resolved` via SSE.',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['acked', 'resolved'] },
        },
        examples: [{ status: 'acked' }, { status: 'resolved' }],
      },
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async (req, reply) => {
    const existing = await db.get(tables.alerts, req.params.id);
    if (!existing || existing.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });

    const { status } = req.body;
    const updates = { status };
    if (status === 'acked')    updates.acked_at    = new Date().toISOString();
    if (status === 'resolved') updates.resolved_at = new Date().toISOString();

    await db.update(tables.alerts, existing.Id, updates);
    const updated = await db.get(tables.alerts, existing.Id);

    broadcastAlert(req.user.Id, { type: `alert.${status}`, payload: updated });

    return updated;
  });

  // DELETE /v1/alerts/:id — hard delete
  fastify.delete('/alerts/:id', {
    preHandler: requireAuth,
    schema: {
      tags: ['Alerts'],
      summary: 'Delete an alert',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      response: { 200: { type: 'object', properties: { ok: { type: 'boolean' } }, example: { ok: true } } },
    },
  }, async (req, reply) => {
    const existing = await db.get(tables.alerts, req.params.id);
    if (!existing || existing.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });
    await db.delete(tables.alerts, existing.Id);
    return { ok: true };
  });

  // GET /v1/alerts/stream — SSE stream for live alert events
  fastify.get('/alerts/stream', {
    schema: {
      tags: ['Alerts'],
      summary: 'Open SSE stream for live alert events',
      description: 'Emits `alert.fired`, `alert.acked`, and `alert.resolved` events in real time.',
      response: {
        200: {
          type: 'string',
          example: 'data: {"type":"connected"}\n\ndata: {"type":"alert.fired","payload":{...}}\n\n',
        },
      },
    },
  }, async (req, reply) => {
    let user = null;
    try {
      await requireAuth(req, reply);
      user = req.user;
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (!user) return;

    reply.raw.writeHead(200, {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('data: {"type":"connected"}\n\n');

    const uid = String(user.Id);
    if (!alertClients.has(uid)) alertClients.set(uid, new Set());
    alertClients.get(uid).add(reply);

    const keepalive = setInterval(() => {
      try { reply.raw.write(': ping\n\n'); } catch { clearInterval(keepalive); }
    }, 25000);

    req.raw.on('close', () => {
      alertClients.get(uid)?.delete(reply);
      clearInterval(keepalive);
    });

    await new Promise(() => {});
  });
}
