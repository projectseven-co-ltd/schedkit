// src/routes/users.js — User management (admin-only, secured by master secret)

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { nanoid } from 'nanoid';

function requireSecret(req, reply, done) {
  if (req.headers['x-admin-secret'] !== process.env.API_SECRET) {
    return reply.code(403).send({ error: 'Forbidden' });
  }
  done();
}

export default async function usersRoutes(fastify) {

  // Create user
  fastify.post('/users', {
    preHandler: requireSecret,
    schema: {
      tags: ['Users'],
      summary: 'Create a user (admin)',
      security: [{ adminSecret: [] }],
      description: 'Create a new SchedKit user account. Requires the `x-admin-secret` header. Returns the new user including their generated `api_key`.',
      body: {
        type: 'object', required: ['name', 'email', 'slug'],
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          slug: { type: 'string', description: 'URL-safe username used in public manifest links (`/assign/:slug/:type`)' },
          timezone: { type: 'string', default: 'UTC' },
        },
      },
    },
  }, async (req, reply) => {
    const { name, email, slug, timezone = 'UTC' } = req.body;
    if (!name || !email || !slug) {
      return reply.code(400).send({ error: 'name, email, slug required' });
    }

    const existing = await db.find(tables.users, `(slug,eq,${slug})`);
    if (existing.list?.length) return reply.code(409).send({ error: 'Slug taken' });

    const api_key = `p7s_${nanoid(32)}`;
    const user = await db.create(tables.users, {
      name, email, slug, timezone, api_key, active: true,
      created_at: new Date().toISOString(),
    });

    return reply.code(201).send({ ...user, api_key });
  });

  // List users
  fastify.get('/users', {
    preHandler: requireSecret,
    schema: {
      tags: ['Users'],
      summary: 'List all users (admin)',
      security: [{ adminSecret: [] }],
      description: 'Returns all users. Requires the `x-admin-secret` header.',
    },
  }, async () => {
    const result = await db.list(tables.users, { limit: 100 });
    return { users: result.list || [] };
  });

  // Update user (admin secret — curl/scripts)
  fastify.patch('/users/:id', {
    preHandler: requireSecret,
    schema: {
      tags: ['Users'],
      summary: 'Update a user (admin)',
      security: [{ adminSecret: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          plan: { type: 'string', enum: ['free', 'starter', 'agency', 'enterprise'] },
          active: { type: 'boolean' },
          name: { type: 'string' },
          slug: { type: 'string' },
          timezone: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const existing = await db.get(tables.users, req.params.id);
    if (!existing) return reply.code(404).send({ error: 'User not found' });
    const updates = {};
    for (const key of ['plan', 'active', 'name', 'slug', 'timezone']) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (!Object.keys(updates).length) return reply.code(400).send({ error: 'No updates' });
    const updated = await db.update(tables.users, existing.Id, updates);
    return updated;
  });

  // Get user profile (public)
  fastify.get('/u/:slug', {
    schema: {
      tags: ['Users'],
      summary: 'Get a public user profile',
      description: 'Returns the public profile for a user by slug. Used by the manifest page to display the host name and timezone.',
      params: {
        type: 'object',
        properties: { slug: { type: 'string', description: 'User\'s URL slug' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            slug: { type: 'string' },
            timezone: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const result = await db.find(tables.users, `(slug,eq,${req.params.slug})`);
    if (!result.list?.length) return reply.code(404).send({ error: 'Not found' });
    const u = result.list[0];
    return { name: u.name, slug: u.slug, timezone: u.timezone };
  });
}
