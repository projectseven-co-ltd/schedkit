// src/routes/signals.mjs — Beacon Mode + Signal feed
//
// Signal types:
//   beacon   — periodic GPS ping from an active operator
//   capture  — photo/image attached to a signal
//   note     — text note with optional coords
//   checkin  — manual "I'm here" with location
//   alert    — high-priority signal (triggers push notification)
//
// Org scoping: signals are tagged with the sender's active org_id.
// SSE stream only delivers signals from orgs the viewer is a member of.

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireSession } from '../middleware/session.mjs';

// ── In-process SSE clients ────────────────────────────
// Map: orgId (string) → Set of reply objects
const signalClientsByOrg = new Map();

export function broadcastSignal(orgId, event) {
  const clients = signalClientsByOrg.get(String(orgId));
  if (!clients) return;
  const data = 'data: ' + JSON.stringify(event) + '\n\n';
  for (const reply of clients) {
    try { reply.raw.write(data); } catch { clients.delete(reply); }
  }
}

// ── Helpers ───────────────────────────────────────────

// Get all org IDs a user belongs to (as owner or member)
async function getUserOrgIds(userId) {
  try {
    const memberships = await db.find(tables.org_members, `(user_id,eq,${userId})`);
    return (memberships.list || []).map(m => String(m.org_id)).filter(Boolean);
  } catch { return []; }
}

// Get the "primary" org for a user — first org they own, or first membership
async function getPrimaryOrgId(userId) {
  const ids = await getUserOrgIds(userId);
  return ids[0] || null;
}

// ── Routes ────────────────────────────────────────────
export default async function signalsRoutes(fastify) {

  // POST /v1/signals — create a signal
  fastify.post('/signals', {
    preHandler: requireSession,
    schema: {
      tags: ['Signals'],
      summary: 'Create a signal (beacon ping, capture, note, alert)',
      body: {
        type: 'object',
        required: ['type'],
        properties: {
          type:      { type: 'string', enum: ['beacon','capture','note','checkin','alert'] },
          lat:       { type: 'number' },
          lng:       { type: 'number' },
          accuracy:  { type: 'number' },
          image_url: { type: 'string' },
          note:      { type: 'string' },
          ticket_id: { type: 'number' },
          org_id:    { type: 'number', description: 'Override org — defaults to user primary org' },
          meta:      { type: 'object' },
        },
      },
      response: { 201: { type: 'object', additionalProperties: true } },
    },
  }, async (req, reply) => {
    const { type, lat, lng, accuracy, image_url, note, ticket_id, meta } = req.body;

    // Resolve org — use provided, else primary
    let orgId = req.body.org_id || null;
    if (!orgId) orgId = await getPrimaryOrgId(req.user.Id);

    // ── Beacon fast-path: skip DB write, broadcast only ──────────────────
    // Beacon pings are ephemeral — only the live position matters.
    // Captures, notes, alerts, and checkins are persisted normally.
    if (type === 'beacon') {
      const result = {
        Id: null,
        user_id: req.user.Id,
        org_id: orgId,
        type: 'beacon',
        lat: lat ?? null,
        lng: lng ?? null,
        accuracy: accuracy ?? null,
        meta: meta ? JSON.stringify(meta) : null,
        created_at: new Date().toISOString(),
        user_name: req.user.name || req.user.email,
      };
      if (orgId) broadcastSignal(orgId, { type: 'signal.beacon', payload: result });
      return reply.code(201).send(result);
    }
    // ── End beacon fast-path ──────────────────────────────────────────────

    const signal = await db.create(tables.signals, {
      user_id:    req.user.Id,
      org_id:     orgId,
      type,
      lat:        lat ?? null,
      lng:        lng ?? null,
      accuracy:   accuracy ?? null,
      image_url:  image_url ?? null,
      note:       note ?? null,
      ticket_id:  ticket_id ?? null,
      meta:       meta ? JSON.stringify(meta) : null,
      created_at: new Date().toISOString(),
    });

    const result = {
      ...signal,
      user_name: req.user.name || req.user.email,
      org_id:    orgId,
    };

    // Broadcast to org channel
    if (orgId) broadcastSignal(orgId, { type: 'signal.' + type, payload: result });

    // Alert type → push notification to org members
    if (type === 'alert' && orgId) {
      try {
        const { sendPushToUser } = await import('./push.mjs');
        // Notify all org members
        const members = await db.find(tables.org_members, `(org_id,eq,${orgId})`);
        const memberIds = (members.list || []).map(m => m.user_id);
        await Promise.allSettled(memberIds.map(uid => sendPushToUser(uid, {
          title: '[~] ALERT SIGNAL',
          body: `${req.user.name || 'Operator'}: ${note || 'Alert signal received'}`,
          url: '/incidents/war-room',
          tag: 'signal-alert-' + signal.Id,
          requireInteraction: true,
        })));
      } catch {}
    }

    return reply.code(201).send(result);
  });

  // GET /v1/signals — list signals for user's orgs
  fastify.get('/signals', {
    preHandler: requireSession,
    schema: {
      tags: ['Signals'],
      summary: 'List signals for the authenticated user\'s orgs',
      querystring: {
        type: 'object',
        properties: {
          type:   { type: 'string' },
          org_id: { type: 'integer' },
          limit:  { type: 'integer', default: 100 },
          since:  { type: 'string' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async (req) => {
    const { type, org_id, limit = 100, since } = req.query;

    let orgIds = org_id ? [String(org_id)] : await getUserOrgIds(req.user.Id);

    // If user has no orgs, fall back to just their own signals
    let where;
    if (orgIds.length > 0) {
      const orgFilter = orgIds.map(id => `(org_id,eq,${id})`).join('~or');
      where = `(${orgFilter})`;
    } else {
      where = `(user_id,eq,${req.user.Id})`;
    }

    if (type) where += `~and(type,eq,${type})`;
    if (since) where += `~and(created_at,gt,${since})`;

    const result = await db.list(tables.signals, { where, sort: '-created_at', limit });
    return { signals: result.list || [], total: result.pageInfo?.totalRows ?? 0 };
  });

  // DELETE /v1/signals/beacon — stop beacon
  fastify.delete('/signals/beacon', {
    preHandler: requireSession,
    schema: { tags: ['Signals'], summary: 'Stop beacon — broadcast beacon_off to org stream' },
  }, async (req) => {
    const orgId = await getPrimaryOrgId(req.user.Id);
    const deviceId = req.body?.device_id || req.query?.device_id || null;
    if (orgId) broadcastSignal(orgId, { type: 'signal.beacon_off', payload: { user_id: req.user.Id, org_id: orgId, device_id: deviceId } });
    return { ok: true };
  });

  // GET /v1/signals/stream — SSE stream scoped to user's orgs
  fastify.get('/signals/stream', {
    schema: { tags: ['Signals'], summary: 'SSE stream — signals from user\'s orgs only' },
  }, async (req, reply) => {
    // Auth: session cookie or api_key query param
    let user = null;
    try {
      await requireSession(req, reply);
      user = req.user;
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (!user) return;

    const orgIds = await getUserOrgIds(user.Id);

    reply.raw.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('data: {"type":"connected","org_ids":' + JSON.stringify(orgIds) + '}\n\n');

    // Register in each org channel
    for (const orgId of orgIds) {
      if (!signalClientsByOrg.has(orgId)) signalClientsByOrg.set(orgId, new Set());
      signalClientsByOrg.get(orgId).add(reply);
    }

    const keepalive = setInterval(() => {
      try { reply.raw.write(': ping\n\n'); } catch { clearInterval(keepalive); }
    }, 25000);

    req.raw.on('close', () => {
      for (const orgId of orgIds) {
        signalClientsByOrg.get(orgId)?.delete(reply);
      }
      clearInterval(keepalive);
    });

    await new Promise(() => {});
  });
}
