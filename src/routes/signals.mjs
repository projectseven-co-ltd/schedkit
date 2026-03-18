import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireSession } from '../lib/auth.mjs';

const SIGNAL_TYPES = ['beacon', 'beacon_off', 'capture', 'status_ok', 'sos', 'noaa_alert', 'webhook', 'scheduled'];
const SEVERITIES = ['info', 'minor', 'moderate', 'severe', 'critical'];

export default async function signalsRoutes(fastify) {

  // POST /v1/signals — ingest a signal from any source
  fastify.post('/signals', {
    preHandler: requireSession,
    schema: {
      tags: ['Signals'],
      summary: 'Ingest a signal',
      description: 'Submit a signal from any source (phone, NOAA, webhook, hardware). Stored and broadcast via SSE to dashboard.',
      body: {
        type: 'object',
        required: ['type', 'source'],
        properties: {
          type: { type: 'string', enum: SIGNAL_TYPES },
          source: { type: 'string' },
          device_id: { type: 'string' },
          severity: { type: 'string', enum: SEVERITIES },
          lat: { type: 'number' },
          lng: { type: 'number' },
          accuracy: { type: 'number' },
          url: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          area: { type: 'string' },
          onset: { type: 'string' },
          expires: { type: 'string' },
          noaa_id: { type: 'string' },
          org_id: { type: 'number' },
        },
      },
      response: {
        200: { type: 'object', properties: { ok: { type: 'boolean' }, signal_id: { type: 'string' } } },
      },
    },
  }, async (req, reply) => {
    const userId = req.user?.Id;
    const signal = {
      user_id: String(userId),
      type: req.body.type,
      source: req.body.source,
      device_id: req.body.device_id || null,
      severity: req.body.severity || 'info',
      lat: req.body.lat ?? null,
      lng: req.body.lng ?? null,
      accuracy: req.body.accuracy ?? null,
      url: req.body.url || null,
      title: req.body.title || null,
      description: req.body.description || null,
      area: req.body.area || null,
      onset: req.body.onset || null,
      expires: req.body.expires || null,
      noaa_id: req.body.noaa_id || null,
      org_id: req.body.org_id || null,
      created_at: new Date().toISOString(),
    };

    // Persist
    const record = await db.create(tables.signals, signal);

    // Broadcast via SSE to all connected dashboard clients
    broadcastSignal(fastify, { ...signal, id: record?.Id });

    return { ok: true, signal_id: String(record?.Id || '') };
  });

  // GET /v1/signals — list recent signals
  fastify.get('/signals', {
    preHandler: requireSession,
    schema: {
      tags: ['Signals'],
      summary: 'List recent signals',
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 50, maximum: 200 },
          type: { type: 'string' },
          source: { type: 'string' },
          org_id: { type: 'integer' },
        },
      },
      response: {
        200: { type: 'object', properties: { signals: { type: 'array', items: { type: 'object' } } } },
      },
    },
  }, async (req) => {
    const { limit = 50, type, source, org_id } = req.query;
    const filters = [];
    if (type) filters.push(`(type,eq,${type})`);
    if (source) filters.push(`(source,eq,${source})`);
    if (org_id) filters.push(`(org_id,eq,${org_id})`);
    const where = filters.length ? filters.join('~and') : undefined;
    const result = await db.find(tables.signals, where, { limit, sort: '-created_at' });
    return { signals: result.list || [] };
  });

  // GET /v1/signals/stream — SSE stream for signals (used by dashboard)
  fastify.get('/signals/stream', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['Signals'],
      summary: 'SSE stream for live signals',
      hide: false,
    },
  }, async (req, reply) => {
    const userId = req.user?.Id ? String(req.user.Id) : null;
    if (!userId) {
      // Try session auth
      const sessionToken = req.cookies?.sk_session || req.headers['x-session-token'];
      if (!sessionToken) return reply.code(401).send({ error: 'unauthorized' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const clientId = Math.random().toString(36).slice(2);
    if (!fastify._signalClients) fastify._signalClients = new Map();
    fastify._signalClients.set(clientId, reply.raw);

    const keepAlive = setInterval(() => {
      reply.raw.write(':keepalive\n\n');
    }, 25000);

    req.raw.on('close', () => {
      clearInterval(keepAlive);
      if (fastify._signalClients) fastify._signalClients.delete(clientId);
    });
  });
}

// Broadcast a signal event to all SSE clients
function broadcastSignal(fastify, signal) {
  if (!fastify._signalClients?.size) return;
  const payload = `data: ${JSON.stringify({ event: 'signal', signal })}\n\n`;
  for (const [id, raw] of fastify._signalClients) {
    try { raw.write(payload); } catch { fastify._signalClients.delete(id); }
  }
}
