// src/routes/users.js — User management (admin-like, secured by master secret)

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
  fastify.post('/users', { preHandler: requireSecret }, async (req, reply) => {
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
  fastify.get('/users', { preHandler: requireSecret }, async () => {
    const result = await db.list(tables.users, { limit: 100 });
    return { users: result.list || [] };
  });

  // Get user profile (public)
  fastify.get('/u/:slug', async (req, reply) => {
    const result = await db.find(tables.users, `(slug,eq,${req.params.slug})`);
    if (!result.list?.length) return reply.code(404).send({ error: 'Not found' });
    const u = result.list[0];
    return { name: u.name, slug: u.slug, timezone: u.timezone };
  });
}
