// Client Flags — reputation/risk tracking per email
// GET    /v1/clients                  list all flags for this user
// GET    /v1/clients/:email           get flag for a specific email
// POST   /v1/clients/:email/flag      create or update flag
// DELETE /v1/clients/:email/flag      remove flag

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireSession as requireAuth } from '../middleware/session.mjs';

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

async function findFlagForUser(userId, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const result = await db.find(tables.client_flags,
    `(flagged_by,eq,${userId})~and(email,eq,${normalized})`);
  return result.list?.[0] || null;
}

async function upsertFlag(userId, email, { risk_level, notes, discount_flag }) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { error: 'invalid_email' };
  const current = await findFlagForUser(userId, normalized);
  const payload = {
    risk_level: risk_level || 'caution',
    notes: notes || '',
    discount_flag: discount_flag || '',
  };
  if (current) {
    await db.update(tables.client_flags, current.Id, { ...payload, email: normalized });
    return { ok: true, action: 'updated', email: normalized, ...payload, id: current.Id };
  }
  const created = await db.create(tables.client_flags, {
    email: normalized,
    ...payload,
    flagged_by: String(userId),
  });
  return { ok: true, action: 'created', email: normalized, ...payload, id: created.Id };
}

export default async function clientFlagRoutes(fastify) {

  // List all flagged clients for this user
  fastify.get('/clients', {
    preHandler: requireAuth,
    schema: {
      tags: ['Clients'],
      summary: 'List flagged clients',
      security: [{ apiKey: [] }],
    },
  }, async (req) => {
    const result = await db.find(tables.client_flags,
      `(flagged_by,eq,${req.user.Id})`, { sort: '-id', limit: 200 });
    const flags = (result.list || []).map(row => ({
      ...row,
      email: normalizeEmail(row.email),
    }));
    return { flags, total: result.pageInfo?.totalRows || flags.length };
  });

  // Create or update flag (email in body — avoids @ in URL paths blocked by nginx)
  fastify.post('/clients/flag', {
    preHandler: requireAuth,
    schema: {
      tags: ['Clients'],
      summary: 'Flag a client (create or update)',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
          risk_level: { type: 'string', enum: ['ok', 'caution', 'high', 'blocked'] },
          notes: { type: 'string' },
          discount_flag: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) return reply.code(400).send({ error: 'invalid_email' });
    const { risk_level = 'caution', notes = '', discount_flag = '' } = req.body || {};
    if (risk_level === 'ok' && !discount_flag && !notes) {
      const existing = await findFlagForUser(req.user.Id, email);
      if (existing) {
        await db.delete(tables.client_flags, existing.Id);
        return { ok: true, action: 'removed', email };
      }
      return { ok: true, action: 'noop', email };
    }
    return upsertFlag(req.user.Id, email, { risk_level, notes, discount_flag });
  });

  fastify.delete('/clients/flag', {
    preHandler: requireAuth,
    schema: {
      tags: ['Clients'],
      summary: 'Remove a client flag',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', format: 'email' } },
      },
    },
  }, async (req, reply) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) return reply.code(400).send({ error: 'invalid_email' });
    const flag = await findFlagForUser(req.user.Id, email);
    if (!flag) return reply.code(404).send({ error: 'No flag found' });
    await db.delete(tables.client_flags, flag.Id);
    return { ok: true, removed: email };
  });

  // Get flag by email
  fastify.get('/clients/:email/flag', {
    preHandler: requireAuth,
    schema: {
      tags: ['Clients'],
      summary: 'Get flag for a client email',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { email: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const email = normalizeEmail(req.params.email);
    if (!email) return reply.code(400).send({ error: 'invalid_email' });
    const flag = await findFlagForUser(req.user.Id, email);
    if (!flag) return reply.code(404).send({ error: 'No flag found for this email' });
    return flag;
  });

  // Create or update flag
  fastify.post('/clients/:email/flag', {
    preHandler: requireAuth,
    schema: {
      tags: ['Clients'],
      summary: 'Flag a client (create or update)',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { email: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          risk_level: { type: 'string', enum: ['ok', 'caution', 'high', 'blocked'], description: 'ok=clear, caution=watch, high=get payment first, blocked=refuse service' },
          notes: { type: 'string', description: 'Free-form notes about this client' },
          discount_flag: { type: 'string', description: 'Discount tier: vet, realtor, partner' },
        },
      },
    },
  }, async (req, reply) => {
    const email = normalizeEmail(req.params.email);
    if (!email) return reply.code(400).send({ error: 'invalid_email' });
    const { risk_level = 'caution', notes = '', discount_flag = '' } = req.body || {};
    return upsertFlag(req.user.Id, email, { risk_level, notes, discount_flag });
  });

  // Remove flag
  fastify.delete('/clients/:email/flag', {
    preHandler: requireAuth,
    schema: {
      tags: ['Clients'],
      summary: 'Remove a client flag',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { email: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const email = normalizeEmail(req.params.email);
    if (!email) return reply.code(400).send({ error: 'invalid_email' });
    const flag = await findFlagForUser(req.user.Id, email);
    if (!flag) return reply.code(404).send({ error: 'No flag found' });
    await db.delete(tables.client_flags, flag.Id);
    return { ok: true, removed: email };
  });
}
