// Client Flags — reputation/risk tracking per email
// GET    /v1/clients                  list all flags for this user
// GET    /v1/clients/:email           get flag for a specific email
// POST   /v1/clients/:email/flag      create or update flag
// DELETE /v1/clients/:email/flag      remove flag

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireSession as requireAuth } from '../middleware/session.mjs';

export default async function clientFlagRoutes(fastify) {

  // List all flagged clients for this user
  fastify.get('/clients', {
    preHandler: requireAuth,
    schema: {
      tags: ['Clients'],
      summary: 'List flagged clients',
      security: [{ apiKey: [] }],
    },
  }, async (req, reply) => {
    const result = await db.find(tables.client_flags,
      `(flagged_by,eq,${req.user.Id})`, { sort: '-CreatedAt', limit: 200 });
    return { flags: result.list || [], total: result.pageInfo?.totalRows || 0 };
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
    const result = await db.find(tables.client_flags,
      `(flagged_by,eq,${req.user.Id})~and(email,eq,${req.params.email})`);
    const flag = result.list?.[0];
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
    const { email } = req.params;
    const { risk_level = 'caution', notes = '', discount_flag = '' } = req.body;

    // Check for existing flag
    const existing = await db.find(tables.client_flags,
      `(flagged_by,eq,${req.user.Id})~and(email,eq,${email})`);
    const current = existing.list?.[0];

    if (current) {
      await db.update(tables.client_flags, current.Id, { risk_level, notes, discount_flag });
      return { ok: true, action: 'updated', email, risk_level, notes, discount_flag };
    } else {
      const created = await db.create(tables.client_flags, {
        email, risk_level, notes, discount_flag, flagged_by: String(req.user.Id),
      });
      return { ok: true, action: 'created', email, risk_level, notes, discount_flag, id: created.Id };
    }
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
    const result = await db.find(tables.client_flags,
      `(flagged_by,eq,${req.user.Id})~and(email,eq,${req.params.email})`);
    const flag = result.list?.[0];
    if (!flag) return reply.code(404).send({ error: 'No flag found' });
    await db.delete(tables.client_flags, flag.Id);
    return { ok: true, removed: req.params.email };
  });
}
