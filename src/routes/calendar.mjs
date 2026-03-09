// src/routes/calendar.mjs — Google Calendar OAuth + connection management

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireSession } from '../middleware/session.mjs';
import { getAuthUrl, exchangeCode } from '../lib/googleCalendar.mjs';
import { nanoid } from 'nanoid';

const BASE_DOMAIN = process.env.BASE_DOMAIN || 'schedkit.net';

export default async function calendarRoutes(fastify) {

  // GET /v1/auth/google/connect — redirect to Google OAuth
  fastify.get('/auth/google/connect', { preHandler: requireSession }, async (req, reply) => {
    // Store state token in session to prevent CSRF
    const state = nanoid(20);
    // Encode user id in state so we know who is connecting
    const statePayload = Buffer.from(JSON.stringify({ userId: req.user.Id, nonce: state })).toString('base64url');
    const url = getAuthUrl(statePayload);
    return reply.redirect(url);
  });

  // GET /google-callback — OAuth callback (top-level to avoid nginx slash-in-param routing issues)
  fastify.get('/google-callback', async (req, reply) => {
    const { code, state, error } = req.query;

    if (error) {
      return reply.redirect('/dashboard?cal_error=access_denied#account');
    }
    if (!code || !state) {
      return reply.redirect('/dashboard?cal_error=missing_params#account');
    }

    let userId;
    try {
      const payload = JSON.parse(Buffer.from(state, 'base64url').toString());
      userId = payload.userId;
    } catch {
      return reply.redirect('/dashboard?cal_error=invalid_state#account');
    }

    try {
      const tokens = await exchangeCode(code);

      // Get calendar email from Google userinfo
      let calendarEmail = '';
      try {
        const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (userInfoRes.ok) {
          const userInfo = await userInfoRes.json();
          calendarEmail = userInfo.email || '';
        }
      } catch(e) { console.error('userinfo fetch failed:', e.message); }

      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

      // Upsert — delete existing then create
      const existing = await db.find(tables.calendar_connections, `(user_id,eq,${userId})~and(provider,eq,google)`);
      if (existing.list?.length) {
        await db.delete(tables.calendar_connections, existing.list[0].Id);
      }

      await db.create(tables.calendar_connections, {
        user_id: String(userId),
        provider: 'google',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || existing.list?.[0]?.refresh_token || '',
        expires_at: expiresAt,
        calendar_email: calendarEmail,
      });

      return reply.redirect('/dashboard?cal_connected=1#account');
    } catch (e) {
      console.error('Google OAuth callback error:', e.message);
      return reply.redirect('/dashboard?cal_error=token_exchange#account');
    }
  });

  // GET /v1/calendar/status — check connection status
  fastify.get('/calendar/status', { preHandler: requireSession }, async (req) => {
    const result = await db.find(tables.calendar_connections, `(user_id,eq,${req.user.Id})~and(provider,eq,google)`);
    const conn = result.list?.[0];
    if (!conn) return { connected: false };
    return { connected: true, provider: 'google', calendar_email: conn.calendar_email };
  });

  // DELETE /v1/calendar/disconnect — remove connection
  fastify.delete('/calendar/disconnect', { preHandler: requireSession }, async (req, reply) => {
    const result = await db.find(tables.calendar_connections, `(user_id,eq,${req.user.Id})~and(provider,eq,google)`);
    if (result.list?.length) {
      await db.delete(tables.calendar_connections, result.list[0].Id);
    }
    return { ok: true };
  });
}

// Separate export for root-level callback registration (no /v1 prefix)
export async function calendarCallbackRoute(fastify) {
  const { exchangeCode } = await import('../lib/googleCalendar.mjs');
  const { db } = await import('../lib/noco.mjs');
  const { tables } = await import('../lib/tables.mjs');

  fastify.get('/google-callback', async (req, reply) => {
    const { code, state, error } = req.query;
    if (error) return reply.redirect('/dashboard?cal_error=access_denied#account');
    if (!code || !state) return reply.redirect('/dashboard?cal_error=missing_params#account');

    let userId;
    try {
      const payload = JSON.parse(Buffer.from(state, 'base64url').toString());
      userId = payload.userId;
    } catch { return reply.redirect('/dashboard?cal_error=invalid_state#account'); }

    try {
      const tokens = await exchangeCode(code);
      let calendarEmail = '';
      try {
        const ui = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (ui.ok) calendarEmail = (await ui.json()).email || '';
      } catch(e) { console.error('userinfo:', e.message); }

      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
      const existing = await db.find(tables.calendar_connections, `(user_id,eq,${userId})~and(provider,eq,google)`);
      if (existing.list?.length) await db.delete(tables.calendar_connections, existing.list[0].Id);
      await db.create(tables.calendar_connections, {
        user_id: String(userId), provider: 'google',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || existing.list?.[0]?.refresh_token || '',
        expires_at: expiresAt, calendar_email: calendarEmail,
      });
      return reply.redirect('/dashboard?cal_connected=1');
    } catch(e) {
      console.error('Google OAuth callback error:', e.message);
      return reply.redirect('/dashboard?cal_error=token_exchange#account');
    }
  });
}
