// src/routes/calendar.mjs — Google Calendar OAuth + connection management

import { db } from '../lib/db.mjs';
import { tables } from '../lib/tables.mjs';
import { requireSession } from '../middleware/session.mjs';
import { getAuthUrl, exchangeCode } from '../lib/googleCalendar.mjs';
import { nanoid } from 'nanoid';

export default async function calendarRoutes(fastify) {

  // GET /v1/auth/google/connect — redirect to Google OAuth
  fastify.get('/auth/google/connect', {
    preHandler: requireSession,
    schema: {
      tags: ['Calendar'],
      summary: 'Connect Google Calendar',
      security: [{ cookieAuth: [] }],
      description: 'Redirects to Google OAuth to authorize calendar access. After authorization, Google redirects back to `/v1/auth/google/callback` and the connection is saved. Visit this URL in the browser — do not call it as an API endpoint.',
    },
  }, async (req, reply) => {
    const statePayload = Buffer.from(JSON.stringify({ userId: req.user.Id, nonce: nanoid(16) })).toString('base64url');
    return reply.redirect(getAuthUrl(statePayload));
  });

  // GET /v1/auth/google/callback — server-side OAuth callback
  fastify.get('/auth/google/callback', {
    schema: {
      tags: ['Calendar'],
      summary: 'Google OAuth callback (internal)',
      description: 'Internal callback URL used by Google after OAuth authorization. Not called directly — Google redirects here after the user grants calendar access.',
      querystring: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          state: { type: 'string' },
          error: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { code, state, error } = req.query;
    if (error) return reply.redirect(`/dashboard?cal_error=${error}`);
    if (!code || !state) return reply.redirect('/dashboard?cal_error=missing_params');

    let userId;
    try {
      const payload = JSON.parse(Buffer.from(state, 'base64url').toString());
      userId = payload.userId;
    } catch { return reply.redirect('/dashboard?cal_error=invalid_state'); }

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
      console.error('Google callback error:', e.message);
      return reply.redirect('/dashboard?cal_error=token_exchange');
    }
  });

  // GET /v1/calendar/status
  fastify.get('/calendar/status', {
    preHandler: requireSession,
    schema: {
      tags: ['Calendar'],
      summary: 'Get calendar connection status',
      security: [{ apiKey: [] }],
      description: 'Returns whether the authenticated user has a Google Calendar connected, and if so, which Google account email is linked.',
      response: {
        200: {
          type: 'object',
          properties: {
            connected: { type: 'boolean' },
            provider: { type: 'string', description: 'Always `google` when connected' },
            calendar_email: { type: 'string', description: 'Google account email linked to the calendar' },
          },
        },
      },
    },
  }, async (req) => {
    const result = await db.find(tables.calendar_connections, `(user_id,eq,${req.user.Id})~and(provider,eq,google)`);
    const conn = result.list?.[0];
    if (!conn) return { connected: false };
    return { connected: true, provider: 'google', calendar_email: conn.calendar_email };
  });

  // DELETE /v1/calendar/disconnect
  fastify.delete('/calendar/disconnect', {
    preHandler: requireSession,
    schema: {
      tags: ['Calendar'],
      summary: 'Disconnect Google Calendar',
      security: [{ apiKey: [] }],
      description: 'Removes the Google Calendar connection for the authenticated user. New bookings will no longer be checked against or synced to Google Calendar.',
      response: {
        200: { type: 'object', properties: { ok: { type: 'boolean' } } },
      },
    },
  }, async (req) => {
    const result = await db.find(tables.calendar_connections, `(user_id,eq,${req.user.Id})~and(provider,eq,google)`);
    if (result.list?.length) await db.delete(tables.calendar_connections, result.list[0].Id);
    return { ok: true };
  });
}
