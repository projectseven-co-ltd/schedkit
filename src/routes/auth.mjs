import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { nanoid } from 'nanoid';
import { addMinutes, addDays } from 'date-fns';
import { sendMagicLink } from '../lib/mailer.mjs';
import { requireSession } from '../middleware/session.mjs';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE_DOMAIN = process.env.BASE_DOMAIN || 'schedkit.net';

export default async function authRoutes(fastify) {

  // POST /v1/auth/magic — request magic link
  fastify.post('/auth/magic', {
    schema: {
      tags: ['Auth'],
      summary: 'Request a magic link login email',
      description: 'Sends a one-time login link to the email address if it matches a registered user.',
      body: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const { email } = req.body;

    const result = await db.find(tables.users, `(email,eq,${email.toLowerCase().trim()})`);
    // Always return 200 — don't leak whether email exists
    if (!result.list?.length) return { ok: true };

    const user = result.list[0];
    const token = nanoid(40);
    const expiresAt = addMinutes(new Date(), 15).toISOString();

    await db.create(tables.magic_links, {
      token,
      user_id: String(user.Id),
      expires_at: expiresAt,
      used: false,
      created_at: new Date().toISOString(),
    });

    const link = `https://${BASE_DOMAIN}/v1/auth/verify?token=${token}`;
    await sendMagicLink({ to: user.email, name: user.name, link });

    return { ok: true };
  });

  // GET /v1/auth/verify?token=... — verify magic link, issue session cookie
  fastify.get('/auth/verify', {
    schema: {
      tags: ['Auth'],
      summary: 'Verify magic link token',
      querystring: { type: 'object', properties: { token: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { token } = req.query;
    if (!token) return reply.code(400).send('Missing token');

    const result = await db.find(tables.magic_links, `(token,eq,${token})`);
    if (!result.list?.length) return renderError(reply, 'Invalid or expired link.');

    const link = result.list[0];
    if (link.used) return renderError(reply, 'This link has already been used.');
    if (new Date(link.expires_at) < new Date()) return renderError(reply, 'This link has expired. Please request a new one.');

    // Mark used
    await db.update(tables.magic_links, link.Id, { used: true });

    // Create session (30 days)
    const sessionToken = nanoid(48);
    const sessionExpiry = addDays(new Date(), 30).toISOString();
    await db.create(tables.sessions, {
      token: sessionToken,
      user_id: String(link.user_id),
      expires_at: sessionExpiry,
      created_at: new Date().toISOString(),
    });

    reply
      .header('Set-Cookie', `sk_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}; Secure`)
      .redirect('/dashboard');
  });

  // POST /v1/auth/logout
  fastify.post('/v1/auth/logout', async (req, reply) => {
    reply
      .header('Set-Cookie', 'sk_session=; Path=/; HttpOnly; Max-Age=0')
      .redirect('/login');
  });

  // GET /v1/auth/me — return current session user
  fastify.get('/auth/me', { preHandler: requireSession }, async (req) => {
    const { Id, name, email, slug, timezone, api_key } = req.user;
    return { Id, name, email, slug, timezone, api_key };
  });

  // PATCH /v1/auth/me — update profile
  fastify.patch('/auth/me', { preHandler: requireSession }, async (req, reply) => {
    const { name, email, timezone } = req.body || {};
    const updated = await db.update(tables.users, req.user.Id, {
      ...(name && { name }),
      ...(email && { email }),
      ...(timezone && { timezone }),
    });
    return updated;
  });
}

function renderError(reply, message) {
  return reply.code(400).type('text/html').send(`<!DOCTYPE html>
<html><head><title>SchedKit</title>
<style>
  body{background:#0a0a0b;color:#e8e8ea;font-family:'Space Grotesk',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  .box{text-align:center;padding:40px}
  h2{color:#ff5f5f;margin-bottom:12px}
  p{color:#5a5a6e;margin-bottom:24px}
  a{color:#DFFF00;text-decoration:none}
</style></head><body>
<div class="box">
  <h2>⚠️ ${message}</h2>
  <a href="/login">← Back to login</a>
</div>
</body></html>`);
}
