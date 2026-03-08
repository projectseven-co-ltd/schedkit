import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';

// Middleware: require dashboard session cookie
export async function requireSession(req, reply) {
  const cookieHeader = req.headers['cookie'] || '';
  const match = cookieHeader.match(/sk_session=([^;]+)/);
  if (!match) return reply.redirect('/login');

  const token = match[1];
  const result = await db.find(tables.sessions, `(token,eq,${token})`);
  if (!result.list?.length) return reply.redirect('/login');

  const session = result.list[0];
  if (new Date(session.expires_at) < new Date()) return reply.redirect('/login');

  const user = await db.get(tables.users, session.user_id);
  if (!user) return reply.redirect('/login');

  req.user = user;
  req.sessionToken = token;
}

// Helper: get session user from cookie (returns null if not authed)
export async function getSessionUser(req) {
  try {
    const cookieHeader = req.headers['cookie'] || '';
    const match = cookieHeader.match(/sk_session=([^;]+)/);
    if (!match) return null;
    const result = await db.find(tables.sessions, `(token,eq,${match[1]})`);
    if (!result.list?.length) return null;
    const session = result.list[0];
    if (new Date(session.expires_at) < new Date()) return null;
    return await db.get(tables.users, session.user_id);
  } catch { return null; }
}
