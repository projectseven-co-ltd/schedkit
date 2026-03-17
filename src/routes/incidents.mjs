// src/routes/incidents.mjs — Real-time incident coordination via SSE

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireApiKey } from '../middleware/auth.mjs';
import { requireSession } from '../middleware/session.mjs';

// Active SSE connections: userId → Set of raw response objects
const connections = new Map();

// Public connections keyed by customer_token
const publicConnections = new Map();

export function broadcast(userId, event) {
  const subs = connections.get(String(userId));
  if (!subs) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of subs) {
    try { res.write(data); } catch {}
  }
}

export function broadcastAll(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const subs of connections.values()) {
    for (const res of subs) {
      try { res.write(data); } catch {}
    }
  }
  // Also broadcast to public connections if ticket-specific
  if (event.payload?.customer_token) {
    broadcastPublic(event.payload.customer_token, event);
  }
}

export function broadcastPublic(token, event) {
  const subs = publicConnections.get(token);
  if (!subs) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of subs) {
    try { res.write(data); } catch {}
  }
}

async function requireAuth(req, reply) {
  if (req.headers['x-api-key']) return requireApiKey(req, reply);
  return requireSession(req, reply);
}

export default async function incidentsRoutes(fastify) {

  // GET /v1/incidents/stream — SSE stream (auth required)
  fastify.get('/incidents/stream', {
    schema: {
      tags: ['Incidents'],
      summary: 'SSE event stream',
      description: 'Server-Sent Events stream for real-time incident updates. Requires auth. Keep connection open — events delivered as `data: {...}\\n\\n`.',
      security: [{ apiKey: [] }, { cookieAuth: [] }],
    },
  }, async (req, reply) => {
    await requireAuth(req, reply);
    if (reply.sent) return;

    const userId = String(req.user.Id);
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`data: ${JSON.stringify({ type: 'connected', payload: { user_id: userId } })}\n\n`);

    if (!connections.has(userId)) connections.set(userId, new Set());
    connections.get(userId).add(reply.raw);

    // Heartbeat every 25s to keep connection alive through proxies
    const hb = setInterval(() => {
      try { reply.raw.write(': ping\n\n'); } catch { clearInterval(hb); }
    }, 25000);

    req.raw.on('close', () => {
      clearInterval(hb);
      const subs = connections.get(userId);
      if (subs) {
        subs.delete(reply.raw);
        if (subs.size === 0) connections.delete(userId);
      }
    });

    // Don't let Fastify close the response
    await new Promise(() => {});
  });

  // GET /v1/incidents/:token/public-stream — public SSE for customer status page
  fastify.get('/incidents/:token/public-stream', {
    schema: {
      tags: ['Incidents'],
      summary: 'Public SSE stream for customer status page',
      description: 'Filtered SSE stream for a specific ticket identified by its customer_token. No auth required.',
      params: { type: 'object', properties: { token: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { token } = req.params;
    // Verify token exists
    const result = await db.find(tables.tickets, `(customer_token,eq,${token})`);
    if (!result?.list?.length) return reply.code(404).send({ error: 'Not found' });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`data: ${JSON.stringify({ type: 'connected', payload: { token } })}\n\n`);

    if (!publicConnections.has(token)) publicConnections.set(token, new Set());
    publicConnections.get(token).add(reply.raw);

    const hb = setInterval(() => {
      try { reply.raw.write(': ping\n\n'); } catch { clearInterval(hb); }
    }, 25000);

    req.raw.on('close', () => {
      clearInterval(hb);
      const subs = publicConnections.get(token);
      if (subs) {
        subs.delete(reply.raw);
        if (subs.size === 0) publicConnections.delete(token);
      }
    });

    await new Promise(() => {});
  });

  // POST /v1/incidents/:id/join
  fastify.post('/incidents/:id/join', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    preHandler: requireAuth,
    schema: {
      tags: ['Incidents'],
      summary: 'Join incident as responder',
      security: [{ apiKey: [] }, { cookieAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const ticketId = req.params.id;
    const ticket = await db.get(tables.tickets, ticketId);
    if (!ticket) return reply.code(404).send({ error: 'Ticket not found' });

    // Check not already joined
    const existing = await db.find(tables.ticket_responders,
      `(ticket_id,eq,${ticketId})~and(user_id,eq,${req.user.Id})`);
    if (existing?.list?.length) return reply.code(409).send({ error: 'Already joined' });

    const row = await db.create(tables.ticket_responders, {
      ticket_id: Number(ticketId),
      user_id: req.user.Id,
      joined_at: new Date().toISOString(),
    });

    broadcastAll({
      type: 'responder.joined',
      payload: { ticket_id: ticketId, user_id: req.user.Id, name: req.user.name || req.user.email },
    });

    return reply.code(201).send(row);
  });

    // POST /v1/incidents/:id/leave
  fastify.post('/incidents/:id/leave', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    preHandler: requireAuth,
    schema: {
      tags: ['Incidents'],
      summary: 'Leave incident',
      security: [{ apiKey: [] }, { cookieAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const ticketId = req.params.id;
    const existing = await db.find(tables.ticket_responders,
      `(ticket_id,eq,${ticketId})~and(user_id,eq,${req.user.Id})`);
    if (!existing?.list?.length) return reply.code(404).send({ error: 'Not a responder' });

    await db.delete(tables.ticket_responders, existing.list[0].Id);

    broadcastAll({
      type: 'responder.left',
      payload: { ticket_id: ticketId, user_id: req.user.Id },
    });

    return { ok: true };
  });

    // POST /v1/incidents/:id/replies — add reply (staff or customer via token)
  fastify.post('/incidents/:id/replies', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['Incidents'],
      summary: 'Add reply to incident',
      description: 'Staff: authenticate with API key or session. Customer: pass `customer_token` query param.',
      params: { type: 'object', properties: { id: { type: 'string' } } },
      querystring: { type: 'object', properties: { customer_token: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['body'],
        properties: {
          body: { type: 'string' },
          author_name: { type: 'string' },
          author_email: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const ticketId = req.params.id;
    const { customer_token } = req.query;
    const { body, author_name, author_email } = req.body;

    let isStaff = false;
    let userId = null;
    let name = author_name || 'Customer';
    let email = author_email || '';

    if (customer_token) {
      // Customer path: verify token matches this ticket
      const ticket = await db.get(tables.tickets, ticketId);
      if (!ticket || ticket.customer_token !== customer_token) {
        return reply.code(403).send({ error: 'Invalid token' });
      }
      name = author_name || 'Customer';
      email = author_email || '';
    } else {
      // Staff path: require auth
      try {
        await requireAuth(req, reply);
      } catch {}
      if (!req.user) return reply.code(401).send({ error: 'Unauthorized' });
      isStaff = true;
      userId = req.user.Id;
      name = req.user.name || req.user.email || 'Staff';
      email = req.user.email || '';
    }

    const ticket = await db.get(tables.tickets, ticketId);
    if (!ticket) return reply.code(404).send({ error: 'Ticket not found' });

    const replyRow = await db.create(tables.ticket_replies, {
      ticket_id: Number(ticketId),
      user_id: userId,
      author_name: name,
      author_email: email,
      body,
      is_staff: isStaff,
      created_at: new Date().toISOString(),
    });

    const event = {
      type: 'reply.added',
      payload: {
        ticket_id: ticketId,
        reply: replyRow,
        customer_token: ticket.customer_token,
      },
    };
    broadcastAll(event);

    return reply.code(201).send(replyRow);
  });

  // PATCH /v1/incidents/:id/responders/location — update responder geo position
  fastify.patch('/incidents/:id/responders/location', {
    preHandler: requireAuth,
    schema: {
      tags: ['Incidents'],
      summary: 'Update responder location',
      description: 'Broadcast responder position update. Auth required. Emits `responder.moved` SSE event.',
      security: [{ apiKey: [] }, { cookieAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['lat', 'lng'],
        properties: {
          lat: { type: 'number' },
          lng: { type: 'number' },
        },
      },
    },
  }, async (req, reply) => {
    const ticketId = req.params.id;
    const { lat, lng } = req.body;

    const existing = await db.find(tables.ticket_responders,
      `(ticket_id,eq,${ticketId})~and(user_id,eq,${req.user.Id})`);
    if (!existing?.list?.length) return reply.code(404).send({ error: 'Not a responder on this incident' });

    await db.update(tables.ticket_responders, existing.list[0].Id, {
      lat,
      lng,
      last_seen: new Date().toISOString(),
    });

    broadcastAll({
      type: 'responder.moved',
      payload: { ticket_id: ticketId, user_id: req.user.Id, lat, lng },
    });

    return { ok: true };
  });

  // GET /v1/incidents/:id/replies
  fastify.get('/incidents/:id/replies', {
    schema: {
      tags: ['Incidents'],
      summary: 'Get reply thread',
      description: 'Returns all replies for an incident. Auth required or customer_token query param.',
      params: { type: 'object', properties: { id: { type: 'string' } } },
      querystring: { type: 'object', properties: { customer_token: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const ticketId = req.params.id;
    const { customer_token } = req.query;

    if (customer_token) {
      const ticket = await db.get(tables.tickets, ticketId);
      if (!ticket || ticket.customer_token !== customer_token) {
        return reply.code(403).send({ error: 'Invalid token' });
      }
    } else {
      await requireAuth(req, reply);
      if (reply.sent) return;
    }

    const result = await db.find(tables.ticket_replies, `(ticket_id,eq,${ticketId})`);
    const replies = (result?.list || []).sort((a, b) =>
      new Date(a.created_at || a.CreatedAt) - new Date(b.created_at || b.CreatedAt));
    return { replies };
  });
}
