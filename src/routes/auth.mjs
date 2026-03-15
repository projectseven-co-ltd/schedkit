import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { nanoid } from 'nanoid';
import { addMinutes, addDays } from 'date-fns';
import { sendMagicLink } from '../lib/mailer.mjs';
import { requireSession } from '../middleware/session.mjs';

const BASE_DOMAIN = process.env.BASE_DOMAIN || 'schedkit.net';

export default async function authRoutes(fastify) {

  // POST /v1/auth/magic — request magic link + code
  fastify.post('/auth/magic', {
    schema: {
      tags: ['Auth'],
      summary: 'Request a magic link login email',
      description: 'Send a one-time magic link and 6-digit login code to a registered user. Always returns `{ ok: true }` so the endpoint does not leak whether an email exists.',
      body: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', format: 'email' }, next: { type: 'string' } },
        examples: [{ email: 'ops@schedkit.net' }],
      },
      response: {
        200: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          example: { ok: true },
        },
      },
    },
  }, async (req) => {
    const email = String(req.body?.email || '').toLowerCase().trim();
    const next = String(req.body?.next || '').slice(0, 200) || null;
    if (!email) return { ok: true };

    let result = await db.find(tables.users, `(email,eq,${email})`);

    // Auto-create account if email not found (signup flow)
    if (!result.list?.length) {
      // Check once more to avoid race-condition duplicates
      const check = await db.find(tables.users, `(email,eq,${email})`);
      if (!check.list?.length) {
        const newUser = await db.create(tables.users, {
          email,
          name: '',
          plan: 'free',
          created_at: new Date().toISOString(),
        });
        result = { list: [newUser] };
      } else {
        result = check;
      }
    }

    const user = result.list[0];
    const code = generateLoginCode();
    const token = `${code}-${nanoid(34)}`;
    const expiresAt = addMinutes(new Date(), 15).toISOString();

    await db.create(tables.magic_links, {
      token,
      user_id: String(user.Id),
      expires_at: expiresAt,
      used: false,
      created_at: new Date().toISOString(),
    });

    const link = `https://${BASE_DOMAIN}/v1/auth/verify?token=${token}${next ? '&next=' + encodeURIComponent(next) : ''}`;
    await sendMagicLink({ to: email, name: user.name, link, code });

    return { ok: true };
  });

  // POST /v1/auth/verify-code — verify short code inside the PWA/web app
  fastify.post('/auth/verify-code', {
    schema: {
      tags: ['Auth'],
      summary: 'Verify short login code',
      description: 'Verify the 6-digit email code inside the web app or PWA and issue a dashboard session cookie for the current browser context.',
      body: {
        type: 'object',
        required: ['email', 'code'],
        properties: {
          email: { type: 'string', format: 'email' },
          code: { type: 'string' },
          next: { type: 'string' },
        },
        examples: [{ email: 'ops@schedkit.net', code: '482193' }],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            destination: { type: 'string' },
          },
          example: { ok: true, destination: '/dashboard' },
        },
      },
    },
  }, async (req, reply) => {
    const email = String(req.body?.email || '').toLowerCase().trim();
    const code = String(req.body?.code || '').replace(/\D/g, '').slice(0, 6);
    const next = String(req.body?.next || '').slice(0, 200) || null;
    if (!email || code.length !== 6) return reply.code(400).send({ ok: false, error: 'invalid_code' });

    const userResult = await db.find(tables.users, `(email,eq,${email})`);
    if (!userResult.list?.length) return reply.code(400).send({ ok: false, error: 'invalid_code' });
    const user = userResult.list[0];

    const links = await db.list(tables.magic_links, {
      where: `(user_id,eq,${user.Id})~and(used,eq,false)`,
      sort: '-created_at',
      limit: '10',
    });

    const match = (links.list || []).find(link => {
      if (!link?.token || !String(link.token).startsWith(`${code}-`)) return false;
      if (link.used) return false;
      if (new Date(link.expires_at) < new Date()) return false;
      return true;
    });

    if (!match) return reply.code(400).send({ ok: false, error: 'invalid_code' });

    await consumeLoginAndCreateSession(reply, match, user, { redirect: false, next });
  });

  // GET /v1/auth/verify?token=... — verify magic link, issue session cookie
  fastify.get('/auth/verify', {
    schema: {
      tags: ['Auth'],
      summary: 'Verify magic link token',
      description: 'Verify a one-time magic link token from email. On success this issues a session cookie and redirects the browser to onboarding or dashboard.',
      querystring: {
        type: 'object',
        properties: { token: { type: 'string' } },
        examples: [{ token: '482193-qx3P7b9nR2wLk6sJm8Tz4Vb1Qh5NcD0EfG' }],
      },
      response: {
        200: {
          type: 'string',
          example: '<html>Redirecting to dashboard...</html>',
        },
      },
    },
  }, async (req, reply) => {
    const token = String(req.query?.token || '');
    const next = String(req.query?.next || '').slice(0, 200) || null;
    if (!token) return reply.code(400).send('Missing token');

    const result = await db.find(tables.magic_links, `(token,eq,${token})`);
    if (!result.list?.length) return renderError(reply, 'Invalid or expired link.');

    const link = result.list[0];
    if (link.used) return renderError(reply, 'This link has already been used.');
    if (new Date(link.expires_at) < new Date()) return renderError(reply, 'This link has expired. Please request a new one.');

    const user = await db.get(tables.users, link.user_id);
    await consumeLoginAndCreateSession(reply, link, user, { redirect: true, next });
  });

  // POST /v1/auth/logout
  fastify.post('/auth/logout', {
    schema: {
      tags: ['Auth'],
      summary: 'Log out',
      description: 'Clear the session cookie and delete the current server-side session record.',
      response: { 200: { type: 'object', properties: { ok: { type: 'boolean' } }, example: { ok: true } } },
    }
  }, async (req, reply) => {
    const cookieHeader = req.headers['cookie'] || '';
    const match = cookieHeader.match(/sk_session=([^;]+)/);
    if (match) {
      try {
        const result = await db.find(tables.sessions, `(token,eq,${match[1]})`);
        if (result.list?.length) await db.delete(tables.sessions, result.list[0].Id);
      } catch {}
    }
    reply
      .header('Set-Cookie', 'sk_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
      .send({ ok: true });
  });

  // GET /v1/auth/me — return current session user
  fastify.get('/auth/me', {
    schema: {
      tags: ['Auth'],
      summary: 'Get current user',
      description: 'Return the authenticated user profile for the active browser session, including API key, plan, and ntfy topic settings.',
      security: [{ cookieAuth: [] }],
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            Id: { type: 'number' },
            name: { type: 'string' },
            email: { type: 'string' },
            slug: { type: 'string' },
            timezone: { type: 'string' },
            api_key: { type: 'string' },
            enterprise: { type: 'boolean' },
            ntfy_topic: { type: 'string' },
            plan: { type: 'string' },
          },
        },
      },
    },
    preHandler: requireSession
  }, async (req) => {
    const { Id, name, email, slug, timezone, api_key, enterprise, ntfy_topic, plan } = req.user;
    return { Id, name, email, slug, timezone, api_key, enterprise: !!enterprise, ntfy_topic: ntfy_topic || "", plan: plan || "free" };
  });

  // PATCH /v1/auth/me — update profile
  fastify.patch('/auth/me', {
    schema: {
      tags: ['Auth'],
      summary: 'Update profile',
      description: 'Update the current session user profile. This is used for onboarding and profile maintenance.',
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          timezone: { type: 'string' },
          ntfy_topic: { type: 'string' },
        },
        examples: [{ name: 'Olson Ops', timezone: 'America/Chicago', ntfy_topic: 'schedkit-ops' }]
      },
      security: [{ cookieAuth: [] }],
      response: {
        200: {
          type: 'object',
          example: {
            Id: 7,
            name: 'Olson Ops',
            email: 'ops@schedkit.net',
            slug: 'olson-ops',
            timezone: 'America/Chicago',
            ntfy_topic: 'schedkit-ops',
          },
        },
      },
    },
    preHandler: requireSession
  }, async (req) => {
    const { name, email, timezone, ntfy_topic } = req.body || {};
    const updates = {
      ...(name && { name }),
      ...(email && { email }),
      ...(timezone && { timezone }),
      ...(ntfy_topic !== undefined && { ntfy_topic }),
    };
    // If user has no name yet (completing onboarding), also update slug from name
    if (name && !req.user.name) {
      const nameSlug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      const slugCheck = await db.find(tables.users, `(slug,eq,${nameSlug})`);
      updates.slug = slugCheck.list?.length ? `${nameSlug}-${nanoid(4)}` : nameSlug;
    }
    const updated = await db.update(tables.users, req.user.Id, updates);
    return updated;
  });
}

function generateLoginCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function consumeLoginAndCreateSession(reply, link, user, { redirect, next }) {
  await db.update(tables.magic_links, link.Id, { used: true });

  const sessionToken = nanoid(48);
  const sessionExpiry = addDays(new Date(), 30).toISOString();
  await db.create(tables.sessions, {
    token: sessionToken,
    user_id: String(link.user_id),
    expires_at: sessionExpiry,
    created_at: new Date().toISOString(),
  });

  const destination = next || ((!user?.name) ? '/onboarding' : '/dashboard');
  reply.header('Set-Cookie', `sk_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}; Secure`);

  if (redirect) return reply.redirect(destination);
  return reply.send({ ok: true, destination });
}

function renderError(reply, message) {
  return reply.code(400).type('text/html').send(`<!DOCTYPE html>
<html><head><title>SchedKit</title>
<style>
  body{background:#0a0a0b;color:#e8e8ea;font-family:'Space Grotesk',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  .box{text-align:center;padding:40px;max-width:480px}
  h2{color:#ff5f5f;margin-bottom:12px}
  p{color:#5a5a6e;margin-bottom:24px;line-height:1.6}
  a{color:#DFFF00;text-decoration:none}
</style></head><body>
<div class="box">
  <h2>⚠️ ${message}</h2>
  <p>If you're using the iPhone app, go back to SchedKit and enter the 6-digit code from your email instead.</p>
  <a href="/login">← Back to login</a>
</div>
</body></html>`);
}
