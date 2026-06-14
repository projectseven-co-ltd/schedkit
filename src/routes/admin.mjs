import { db } from '../lib/db.mjs';
import { tables } from '../lib/tables.mjs';
import { requirePlatformAdmin } from '../middleware/platformAdmin.mjs';

const PLANS = new Set(['free', 'starter', 'agency', 'enterprise']);

export default async function adminRoutes(fastify) {
  fastify.get('/admin/users', {
    preHandler: requirePlatformAdmin,
    schema: {
      tags: ['Admin'],
      summary: 'List users (platform admin)',
      security: [{ cookieAuth: [] }],
    },
  }, async () => {
    const result = await db.list(tables.users, { limit: 500, sort: '-created_at' });
    const users = (result.list || []).map(u => ({
      Id: u.Id,
      name: u.name || '',
      email: u.email || '',
      slug: u.slug || '',
      plan: u.plan || 'free',
      active: u.active !== false,
      timezone: u.timezone || '',
      created_at: u.created_at || null,
    }));
    return { users };
  });

  fastify.patch('/admin/users/:id', {
    preHandler: requirePlatformAdmin,
    schema: {
      tags: ['Admin'],
      summary: 'Update a user (platform admin)',
      security: [{ cookieAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          plan: { type: 'string', enum: ['free', 'starter', 'agency', 'enterprise'] },
          active: { type: 'boolean' },
          name: { type: 'string' },
          slug: { type: 'string' },
          timezone: { type: 'string' },
          ntfy_topic: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const existing = await db.get(tables.users, req.params.id);
    if (!existing) return reply.code(404).send({ error: 'User not found' });

    const updates = {};
    if (req.body.plan !== undefined) {
      if (!PLANS.has(req.body.plan)) return reply.code(400).send({ error: 'Invalid plan' });
      updates.plan = req.body.plan;
    }
    if (req.body.active !== undefined) updates.active = !!req.body.active;
    if (req.body.name !== undefined) updates.name = String(req.body.name).trim();
    if (req.body.slug !== undefined) {
      const slug = String(req.body.slug).trim().toLowerCase();
      if (!slug) return reply.code(400).send({ error: 'slug required' });
      const taken = await db.find(tables.users, `(slug,eq,${slug})`);
      if (taken.list?.some(u => String(u.Id) !== String(existing.Id))) {
        return reply.code(409).send({ error: 'Slug taken' });
      }
      updates.slug = slug;
    }
    if (req.body.timezone !== undefined) updates.timezone = String(req.body.timezone).trim();
    if (req.body.ntfy_topic !== undefined) updates.ntfy_topic = String(req.body.ntfy_topic).trim();

    if (!Object.keys(updates).length) return reply.code(400).send({ error: 'No updates' });

    const updated = await db.update(tables.users, existing.Id, updates);
    return {
      Id: updated.Id,
      name: updated.name || '',
      email: updated.email || '',
      slug: updated.slug || '',
      plan: updated.plan || 'free',
      active: updated.active !== false,
      timezone: updated.timezone || '',
    };
  });
}
