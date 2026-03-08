// src/middleware/auth.js — API key authentication

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';

export async function requireApiKey(request, reply) {
  const key = request.headers['x-api-key'] || request.query.api_key;
  if (!key) return reply.code(401).send({ error: 'Missing API key' });

  const result = await db.find(tables.users, `(api_key,eq,${key})`);
  if (!result.list?.length) return reply.code(401).send({ error: 'Invalid API key' });

  const user = result.list[0];
  if (!user.active) return reply.code(403).send({ error: 'Account inactive' });

  request.user = user;
}
