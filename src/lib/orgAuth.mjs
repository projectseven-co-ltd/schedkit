// src/lib/orgAuth.mjs — Org API key middleware

import { db } from './db.mjs';
import { tables } from './tables.mjs';
import { getSessionUser } from '../middleware/session.mjs';

/**
 * requireOrgKey — preHandler middleware
 * Reads x-org-key header, finds the org, sets req.org.
 * If there's a session user, also sets req.orgMember.
 */
export async function requireOrgKey(req, reply) {
  const key = req.headers['x-org-key'];
  if (!key) return reply.code(401).send({ error: 'x-org-key header required' });

  const result = await db.find(tables.organizations, `(api_key,eq,${key})`);
  if (!result.list?.length) return reply.code(401).send({ error: 'Invalid org key' });

  req.org = result.list[0];

  // Try to attach session user membership
  const user = await getSessionUser(req);
  if (user) {
    const memberResult = await db.find(
      tables.org_members,
      `(org_id,eq,${req.org.Id})~and(user_id,eq,${user.Id})`
    );
    req.orgMember = memberResult.list?.[0] || null;
    req.user = user;
  }
}
