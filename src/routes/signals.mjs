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

// ── Active beacon tracking (server-side) ─────────────
// Map: deviceId (string) → { userId, orgId, firstSeen: ms }
// Used to detect beacon_on (first ping from device) without a DB read per ping.
// Cleared on beacon_off or stale prune (>5min since last ping).
const _activeBeacons = new Map();
const BEACON_STALE_MS = 5 * 60 * 1000; // 5 minutes

// Prune stale beacons every 2 minutes
setInterval(() => {
  const cutoff = Date.now() - BEACON_STALE_MS;
  for (const [k, v] of _activeBeacons) {
    if (v.lastSeen < cutoff) _activeBeacons.delete(k);
  }
}, 120_000);

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

const signalCreateExample = {
  type: 'beacon',
  lat: 35.4676,
  lng: -97.5164,
  accuracy: 10,
  meta: { device_id: 'dev-abc123-xyz', battery: 81 },
};

const signalResponseExample = {
  Id: 301,
  user_id: 7,
  org_id: 4,
  type: 'beacon',
  lat: 35.4676,
  lng: -97.5164,
  accuracy: 10,
  meta: '{"device_id":"dev-abc123-xyz","battery":81}',
  created_at: '2026-03-15T18:00:00Z',
  user_name: 'Olson Ops',
};

// ── Routes ────────────────────────────────────────────
export default async function signalsRoutes(fastify) {

  // POST /v1/signals — create a signal
  fastify.post('/signals', {
    preHandler: requireSession,
    schema: {
      tags: ['Signals'],
      summary: 'Create a signal (beacon ping, capture, note, alert)',
      description: 'Create a new org-scoped signal. Beacon pings are broadcast live and only persist a `beacon_on` record on first activation; other signal types are written to storage and optionally trigger push notifications.',
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
          meta:      { type: 'object', additionalProperties: true },
        },
        examples: [signalCreateExample],
      },
      response: { 201: { type: 'object', additionalProperties: true, example: signalResponseExample } },
    },
  }, async (req, reply) => {
    const { type, lat, lng, accuracy, image_url, note, ticket_id, meta } = req.body;

    // Resolve org — use provided, else primary
    let orgId = req.body.org_id || null;
    if (!orgId) orgId = await getPrimaryOrgId(req.user.Id);

    // ── Beacon fast-path: skip DB write for pings, broadcast only ────────
    // Beacon pings are ephemeral — only the live position matters.
    // EXCEPT: first ping from a device writes a beacon_on log entry.
    if (type === 'beacon') {
      const deviceId = (meta && meta.device_id) ? meta.device_id : null;
      const beaconKey = deviceId || `user-${req.user.Id}`;
      const isNew = !_activeBeacons.has(beaconKey);

      _activeBeacons.set(beaconKey, { userId: req.user.Id, orgId, lastSeen: Date.now() });

      // First ping — write beacon_on to DB
      if (isNew) {
        try {
          await db.create(tables.signals, {
            user_id: req.user.Id,
            org_id: orgId || null,
            type: 'beacon_on',
            lat: lat ?? null,
            lng: lng ?? null,
            accuracy: accuracy ?? null,
            meta: JSON.stringify({ device_id: deviceId }),
            created_at: new Date().toISOString(),
          });
        } catch (e) {
          fastify.log.warn('beacon_on db write failed: ' + e.message);
        }
      }

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

    let signal;
    try {
      signal = await db.create(tables.signals, {
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
    } catch (e) {
      fastify.log.error('signals create error: ' + e.message);
      return reply.code(500).send({ error: 'Failed to save signal: ' + e.message });
    }

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
      description: 'Return persisted signals for the orgs the current user belongs to. Beacon pings themselves are live-only, so use this for captures, notes, alerts, and audit records.',
      querystring: {
        type: 'object',
        properties: {
          type:   { type: 'string' },
          org_id: { type: 'integer' },
          limit:  { type: 'integer', default: 100 },
          since:  { type: 'string' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true, example: { signals: [signalResponseExample], total: 1 } } },
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

  // DELETE /v1/signals/beacon — stop beacon, persist beacon_off log entry
  fastify.delete('/signals/beacon', {
    preHandler: requireSession,
    schema: {
      tags: ['Signals'],
      summary: 'Stop beacon and broadcast beacon_off',
      description: 'Stop the current device beacon, clear it from the active tracker, write a `beacon_off` audit record, and broadcast the stop event to the org stream.',
      body: {
        type: 'object',
        properties: { device_id: { type: 'string' } },
        examples: [{ device_id: 'dev-abc123-xyz' }],
      },
      response: { 200: { type: 'object', properties: { ok: { type: 'boolean' } }, example: { ok: true } } },
    },
  }, async (req) => {
    const orgId = await getPrimaryOrgId(req.user.Id);
    const deviceId = req.body?.device_id || req.query?.device_id || null;
    const beaconKey = deviceId || `user-${req.user.Id}`;
    // Clear active beacon tracker so next start logs beacon_on again
    _activeBeacons.delete(beaconKey);
    // Persist beacon_off to DB for audit trail
    let logEntry = null;
    try {
      logEntry = await db.create(tables.signals, {
        user_id: req.user.Id,
        org_id: orgId || null,
        type: 'beacon_off',
        meta: JSON.stringify({ device_id: deviceId }),
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      fastify.log.warn('beacon_off db write failed: ' + e.message);
    }
    const payload = {
      user_id: req.user.Id,
      org_id: orgId,
      device_id: deviceId,
      created_at: logEntry?.created_at || new Date().toISOString(),
    };
    if (orgId) broadcastSignal(orgId, { type: 'signal.beacon_off', payload });
    return { ok: true };
  });

  // GET /v1/signals/log — beacon lifecycle log (beacon_off events + persisted signals)
  fastify.get('/signals/log', {
    preHandler: requireSession,
    schema: {
      tags: ['Signals'],
      summary: 'List signal audit log entries',
      description: 'Return persisted signal log records such as `beacon_off`, `capture`, `alert`, or other audit-worthy signal entries for the current org.',
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 50, maximum: 200 },
          offset: { type: 'integer', default: 0 },
          type: { type: 'string', description: 'Filter by signal type (e.g. beacon_off, alert, capture)' },
          device_id: { type: 'string' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true, example: { entries: [{ ...signalResponseExample, type: 'alert', note: 'Pipe pressure drop' }], total: 1, limit: 50, offset: 0 } } },
    },
  }, async (req) => {
    const orgId = await getPrimaryOrgId(req.user.Id);
    const { limit = 50, offset = 0, type: typeFilter, device_id: deviceFilter } = req.query;
    let where = orgId ? `(org_id,eq,${orgId})` : `(user_id,eq,${req.user.Id})`;
    if (typeFilter) where += `~and(type,eq,${typeFilter})`;
    if (deviceFilter) where += `~and(meta,like,%${deviceFilter}%)`;
    const result = await db.find(tables.signals, where, { limit, offset, sort: '-created_at' });
    return {
      entries: result?.list || [],
      total: result?.pageInfo?.totalRows || 0,
      limit,
      offset,
    };
  });

  // GET /v1/signals/stream — SSE stream scoped to user's orgs
  fastify.get('/signals/stream', {
    schema: {
      tags: ['Signals'],
      summary: 'Open SSE stream for live signals',
      description: 'Open a server-sent events stream that emits live signal events for the orgs the authenticated user belongs to.',
      response: {
        200: {
          type: 'string',
          example: 'data: {"type":"connected","org_ids":["4"]}\n\ndata: {"type":"signal.beacon","payload":{"device_id":"dev-abc123-xyz"}}\n\n',
        },
      },
    },
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
