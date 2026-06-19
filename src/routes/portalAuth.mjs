import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { verifyPassword } from '../lib/password.mjs';
import { findContactByEmail, resolvePortalIdentity } from '../middleware/portalClient.mjs';
import { addDays } from 'date-fns';
import { nanoid } from 'nanoid';

const PASSWORD_LOGIN_ENABLED = process.env.AUTH_PASSWORD_LOGIN_ENABLED !== 'false';
const PORTAL_COOKIE_DOMAIN = process.env.PORTAL_COOKIE_DOMAIN || '';

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

function portalSessionCookie(token) {
  const domainPart = PORTAL_COOKIE_DOMAIN ? `; Domain=${PORTAL_COOKIE_DOMAIN}` : '';
  return `sk_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}; Secure${domainPart}`;
}

async function createSessionForUser(user) {
  const sessionToken = nanoid(48);
  const sessionExpiry = addDays(new Date(), 30).toISOString();
  await db.create(tables.sessions, {
    token: sessionToken,
    user_id: String(user.Id),
    expires_at: sessionExpiry,
    created_at: new Date().toISOString(),
  });
  return sessionToken;
}

export default async function portalAuthRoutes(fastify) {
  // POST /v1/portal/auth/login — Blesta-compatible portal login
  fastify.post('/auth/login', {
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    schema: {
      tags: ['Portal'],
      summary: 'Client portal login',
      body: {
        type: 'object',
        required: ['password'],
        properties: {
          username: { type: 'string' },
          email: { type: 'string' },
          password: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    if (!PASSWORD_LOGIN_ENABLED) {
      return reply.code(403).send({ authenticated: false, error: 'Password login disabled' });
    }

    const email = normalizeLogin(req.body?.email || req.body?.username);
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return reply.code(401).send({ authenticated: false, error: 'Incorrect username or password.' });
    }

    const contact = await findContactByEmail(email);
    if (!contact) {
      return reply.code(401).send({ authenticated: false, error: 'Incorrect username or password.' });
    }

    let user = null;
    if (contact.user_id) {
      user = await db.get(tables.users, contact.user_id);
    }
    if (!user) {
      const userResult = await db.find(tables.users, `(email,eq,${email})`);
      user = userResult.list?.[0];
      if (user) {
        await db.update(tables.client_contacts, contact.Id, { user_id: String(user.Id) });
      }
    }

    if (!user?.password_hash) {
      return reply.code(401).send({ authenticated: false, error: 'Incorrect username or password.' });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return reply.code(401).send({ authenticated: false, error: 'Incorrect username or password.' });
    }

    const client = await db.get(tables.clients, contact.client_id);
    if (!client || client.status === 'inactive') {
      return reply.code(403).send({ authenticated: false, error: 'Account inactive' });
    }

    const sessionToken = await createSessionForUser(user);
    reply.header('Set-Cookie', portalSessionCookie(sessionToken));
    return {
      authenticated: true,
      client_id: Number(client.Id ?? client.id),
      name: contact.name || user.name || '',
      email: contact.email || user.email,
    };
  });

  // GET /v1/portal/auth/me — Blesta-compatible session check
  fastify.get('/auth/me', {
    schema: {
      tags: ['Portal'],
      summary: 'Portal session check',
    },
  }, async (req, reply) => {
    const cookieHeader = req.headers['cookie'] || '';
    const match = cookieHeader.match(/sk_session=([^;]+)/);
    if (!match) return { authenticated: false, client_id: null };

    const result = await db.find(tables.sessions, `(token,eq,${match[1]})`);
    if (!result.list?.length) return { authenticated: false, client_id: null };

    const session = result.list[0];
    if (new Date(session.expires_at) < new Date()) return { authenticated: false, client_id: null };

    const user = await db.get(tables.users, session.user_id);
    if (!user) return { authenticated: false, client_id: null };

    const identity = await resolvePortalIdentity(user);
    if (!identity) return { authenticated: false, client_id: null };

    return {
      authenticated: true,
      client_id: Number(identity.client.Id ?? identity.client.id),
      name: identity.contact.name || user.name || '',
      email: identity.contact.email || user.email,
    };
  });

  // POST /v1/portal/auth/logout
  fastify.post('/auth/logout', {
    schema: { tags: ['Portal'], summary: 'Portal logout' },
  }, async (req, reply) => {
    const cookieHeader = req.headers['cookie'] || '';
    const match = cookieHeader.match(/sk_session=([^;]+)/);
    if (match) {
      try {
        const result = await db.find(tables.sessions, `(token,eq,${match[1]})`);
        if (result.list?.length) await db.delete(tables.sessions, result.list[0].Id);
      } catch {}
    }
    const domainPart = PORTAL_COOKIE_DOMAIN ? `; Domain=${PORTAL_COOKIE_DOMAIN}` : '';
    reply.header('Set-Cookie', `sk_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${domainPart}`);
    return { ok: true, authenticated: false };
  });
}
