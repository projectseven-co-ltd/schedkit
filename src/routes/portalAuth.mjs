import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { verifyPassword } from '../lib/password.mjs';
import { findContactByEmail, resolvePortalIdentity } from '../middleware/portalClient.mjs';
import { sessionCookie, clearSessionCookie } from '../lib/sessionCookie.mjs';
import {
  blestaBridgeConfigured,
  validateBlestaLogin,
  provisionFromBlestaUser,
} from '../lib/blestaBridge.mjs';
import { addDays } from 'date-fns';
import { nanoid } from 'nanoid';

const PASSWORD_LOGIN_ENABLED = process.env.AUTH_PASSWORD_LOGIN_ENABLED !== 'false';
const PORTAL_ORG_SLUG = process.env.PORTAL_ORG_SLUG || 'projectseven';
const PORTAL_BRIDGE_SECRET = process.env.PORTAL_BRIDGE_SECRET || '';

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
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

async function createBlestaBridgeSession(userId, email, reply, { setCookie = true } = {}) {
  const identity = await provisionFromBlestaUser(userId, PORTAL_ORG_SLUG);
  if (!identity?.user || !identity?.client) return null;

  const sessionToken = await createSessionForUser(identity.user);
  if (setCookie) reply.header('Set-Cookie', sessionCookie(sessionToken));

  return {
    authenticated: true,
    client_id: Number(identity.client.Id ?? identity.client.id),
    name: identity.contact?.name || identity.user.name || '',
    email: identity.contact?.email || identity.user.email || email,
    source: 'blesta_bridge',
    sessionToken,
  };
}

async function loginViaBlestaBridge(email, password, reply) {
  if (!blestaBridgeConfigured()) return null;

  try {
    const auth = await validateBlestaLogin(email, password);
    if (!auth) return null;
    return await createBlestaBridgeSession(auth.user_id, email, reply);
  } catch (err) {
    reply.log.warn({ err: err.message }, 'Blesta bridge login failed');
    if (String(err.message).includes('Portal org not found')) {
      throw err;
    }
    return null;
  }
}

async function loginViaSchedkit(email, password, reply) {
  const contact = await findContactByEmail(email);
  if (!contact) return null;

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

  if (!user?.password_hash) return null;

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return null;

  const client = await db.get(tables.clients, contact.client_id);
  if (!client || client.status === 'inactive') return null;

  const sessionToken = await createSessionForUser(user);
  reply.header('Set-Cookie', sessionCookie(sessionToken));

  return {
    authenticated: true,
    client_id: Number(client.Id ?? client.id),
    name: contact.name || user.name || '',
    email: contact.email || user.email,
    source: 'schedkit',
  };
}

export default async function portalAuthRoutes(fastify) {
  fastify.get('/auth/capabilities', {
    schema: { tags: ['Portal'], summary: 'Portal auth capabilities' },
  }, async () => ({
    passwordLoginEnabled: PASSWORD_LOGIN_ENABLED,
    blestaBridgeEnabled: blestaBridgeConfigured(),
    orgSlug: PORTAL_ORG_SLUG,
  }));

  // POST /v1/portal/auth/login
  fastify.post('/auth/login', {
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    schema: {
      tags: ['Portal'],
      summary: 'Client portal login (Blesta bridge + SchedKit native)',
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

    let result = null;
    try {
      result = await loginViaBlestaBridge(email, password, reply);
    } catch (err) {
      if (String(err.message).includes('Portal org not found')) {
        return reply.code(503).send({
          authenticated: false,
          error: 'Portal is still starting up. Try again in a minute or contact support.',
        });
      }
      throw err;
    }
    if (!result) {
      result = await loginViaSchedkit(email, password, reply);
    }

    if (!result) {
      return reply.code(401).send({ authenticated: false, error: 'Incorrect username or password.' });
    }

    return result;
  });

  // POST /v1/portal/auth/exchange — trusted portal proxy issues session after local Blesta auth
  fastify.post('/auth/exchange', {
    config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
    schema: {
      tags: ['Portal'],
      summary: 'Exchange validated Blesta user_id for SchedKit portal session (portal proxy only)',
      body: {
        type: 'object',
        required: ['user_id'],
        properties: {
          user_id: { type: 'integer' },
          username: { type: 'string' },
          email: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const secret = String(req.headers['x-portal-bridge-secret'] || '');
    if (!PORTAL_BRIDGE_SECRET || secret !== PORTAL_BRIDGE_SECRET) {
      return reply.code(403).send({ authenticated: false, error: 'Forbidden' });
    }

    const userId = Number(req.body?.user_id);
    const email = normalizeLogin(req.body?.email || req.body?.username);
    if (!userId || !email) {
      return reply.code(400).send({ authenticated: false, error: 'Missing user_id or username' });
    }

    try {
      const result = await createBlestaBridgeSession(userId, email, reply, { setCookie: false });
      if (!result) {
        return reply.code(502).send({
          authenticated: false,
          error: 'Could not provision portal account. Contact support.',
        });
      }
      return result;
    } catch (err) {
      reply.log.warn({ err: err.message, userId }, 'Portal auth exchange failed');
      if (String(err.message).includes('Portal org not found')) {
        return reply.code(503).send({
          authenticated: false,
          error: 'Portal is still starting up. Try again in a minute or contact support.',
        });
      }
      return reply.code(502).send({
        authenticated: false,
        error: 'Portal sign-in temporarily unavailable. Try again shortly.',
      });
    }
  });

  fastify.get('/auth/me', {
    schema: { tags: ['Portal'], summary: 'Portal session check' },
  }, async (req) => {
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
    reply.header('Set-Cookie', clearSessionCookie());
    return { ok: true, authenticated: false };
  });
}
