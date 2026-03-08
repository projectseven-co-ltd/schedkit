import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';

// Middleware: require dashboard session cookie
export async function requireSession(req, reply) {
  const cookieHeader = req.headers['cookie'] || '';
  const match = cookieHeader.match(/sk_session=([^;]+)/);
  // If it's an API/XHR call return 401 JSON; otherwise redirect
  const isApi = req.headers['x-requested-with'] === 'XMLHttpRequest' ||
    (req.headers['accept'] || '').includes('application/json') ||
    req.url.startsWith('/v1/');
  const unauth = (msg) => isApi
    ? reply.code(401).send({ error: msg })
    : reply.redirect('/login');

  if (!match) return unauth('Not authenticated');

  const token = match[1];
  const result = await db.find(tables.sessions, `(token,eq,${token})`);
  if (!result.list?.length) return unauth('Session not found');

  const session = result.list[0];
  if (new Date(session.expires_at) < new Date()) return unauth('Session expired');

  const user = await db.get(tables.users, session.user_id);
  if (!user) return unauth('User not found');

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
