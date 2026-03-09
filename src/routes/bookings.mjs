// src/routes/bookings.js

import { isSlotBusy, createCalendarEvent, deleteCalendarEvent } from '../lib/googleCalendar.mjs';
import { notifyNewBooking, notifyBookingCancelled } from '../lib/notify.mjs';
import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireApiKey } from '../middleware/auth.mjs';
import { requireSession } from '../middleware/session.mjs';
async function requireAuth(req, reply) {
  if (req.headers['x-api-key']) return requireApiKey(req, reply);
  return requireSession(req, reply);
}
import { addMinutes, parseISO } from 'date-fns';
import { nanoid } from 'nanoid';
import { sendBookingConfirmation, sendCancellationEmail } from '../lib/mailer.mjs';

async function fireWebhook(url, payload) {
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    console.warn('Webhook failed:', e.message);
  }
}

export default async function bookingsRoutes(fastify) {
  // List bookings (authed)
  fastify.get('/bookings', {
    preHandler: requireAuth,
    schema: {
      tags: ['Bookings'],
      summary: 'List bookings',
      security: [{ apiKey: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['confirmed', 'cancelled', 'rescheduled'], description: 'Filter by status' },
          limit: { type: 'integer', default: 50 },
          page: { type: 'integer', default: 1 },
        },
      },
    },
  }, async (req) => {
    const { status, limit = 50, page = 1 } = req.query;
    let where = `(user_id,eq,${req.user.Id})`;
    if (status) where += `~and(status,eq,${status})`;

    const result = await db.list(tables.bookings, {
      where,
      limit,
      offset: (page - 1) * limit,
      sort: '-start_time',
    });
    return { bookings: result.list || [], total: result.pageInfo?.totalRows || 0 };
  });

  // Get single booking (authed)
  fastify.get('/bookings/:id', {
    preHandler: requireAuth,
    schema: {
      tags: ['Bookings'],
      summary: 'Get booking',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const row = await db.get(tables.bookings, req.params.id);
    if (!row || row.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });
    return row;
  });

  // Admin reschedule — host moves a confirmed booking to a new slot
  fastify.post('/bookings/:id/reschedule', {
    preHandler: requireAuth,
    schema: {
      tags: ['Bookings'],
      summary: 'Admin reschedule a booking',
      description: 'Moves a confirmed booking to a new start time. Sends a reschedule notification email to the attendee.',
      security: [{ apiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object', required: ['start_time'],
        properties: {
          start_time: { type: 'string', description: 'New ISO start time' },
          override: { type: 'boolean', description: 'If true, bypasses availability/slot validation — allows any date/time including weekends' },
        },
      },
    },
  }, async (req, reply) => {
    const booking = await db.get(tables.bookings, req.params.id);
    if (!booking || booking.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });
    if (booking.status === 'cancelled') return reply.code(400).send({ error: 'Cannot reschedule a cancelled booking' });

    const et = await db.get(tables.event_types, booking.event_type_id);
    const duration = et?.duration_minutes || 30;
    const oldStart = booking.start_time;
    const newStart = new Date(req.body.start_time);
    const newEnd = new Date(newStart.getTime() + duration * 60000);

    await db.update(tables.bookings, booking.Id, {
      start_time: newStart.toISOString(),
      end_time: newEnd.toISOString(),
      status: 'confirmed',
    });

    // Notify attendee
    const BASE_DOMAIN = process.env.BASE_DOMAIN || 'schedkit.net';
    const userResult = await db.get(tables.users, booking.user_id);
    try {
      const { sendRescheduleNotification } = await import('../lib/mailer.mjs');
      await sendRescheduleNotification({
        attendee_name: booking.attendee_name,
        attendee_email: booking.attendee_email,
        host_name: userResult?.name || 'your host',
        event_title: et?.title || 'Meeting',
        appointment_label: et?.appointment_label || 'meeting',
        old_time: oldStart,
        new_time: newStart.toISOString(),
        timezone: booking.attendee_timezone || 'UTC',
        cancel_url: `https://${BASE_DOMAIN}/v1/cancel/${booking.cancel_token}`,
        reschedule_url: `https://${BASE_DOMAIN}/v1/reschedule/${booking.reschedule_token}`,
      });
    } catch(e) { fastify.log.error('Reschedule email failed:', e.message); }

    return { ok: true, start_time: newStart.toISOString(), end_time: newEnd.toISOString(), override: !!req.body.override };
  });

  // PUBLIC: Create booking
  // POST /book/:username/:event_slug
  fastify.post('/book/:username/:event_slug', async (req, reply) => {
    const { username, event_slug } = req.params;
    const { start_time, attendee_name, attendee_email, attendee_timezone = 'UTC', notes, custom_responses } = req.body;

    if (!start_time || !attendee_name || !attendee_email) {
      return reply.code(400).send({ error: 'start_time, attendee_name, attendee_email required' });
    }

    const userResult = await db.find(tables.users, `(slug,eq,${username})`);
    if (!userResult.list?.length) return reply.code(404).send({ error: 'User not found' });
    const user = userResult.list[0];

    const etResult = await db.find(
      tables.event_types,
      `(user_id,eq,${user.Id})~and(slug,eq,${event_slug})~and(active,eq,true)`
    );
    if (!etResult.list?.length) return reply.code(404).send({ error: 'Event type not found' });
    const eventType = etResult.list[0];

    // Validate required custom fields
    if (eventType.custom_fields) {
      let fields = [];
      try { fields = JSON.parse(eventType.custom_fields); } catch {}
      const responses = custom_responses || {};
      for (const f of fields) {
        if (f.required && !responses[f.id]?.toString().trim()) {
          return reply.code(400).send({ error: `Field "${f.label}" is required` });
        }
      }
    }

    const start = parseISO(start_time);
    const end = addMinutes(start, eventType.duration_minutes);

    // Google Calendar busy check (non-blocking if no calendar connected)
    const busy = await isSlotBusy(user.Id, start.toISOString(), end.toISOString());
    if (busy) {
      return reply.code(409).send({ error: 'Time slot no longer available' });
    }

    // Conflict check — NocoDB doesn't support ISO datetimes in where filters, filter in JS
    const existing = await db.find(tables.bookings, `(user_id,eq,${user.Id})~and(status,eq,confirmed)`);
    const startMs = start.getTime(), endMs = end.getTime();
    const conflict = (existing.list || []).some(b => {
      const bStart = new Date(b.start_time).getTime();
      const bEnd = new Date(b.end_time).getTime();
      return bStart < endMs && bEnd > startMs;
    });
    if (conflict) {
      return reply.code(409).send({ error: 'Time slot no longer available' });
    }

    const uid = nanoid(12);
    const cancel_token = nanoid(24);
    const reschedule_token = nanoid(24);

    const booking = await db.create(tables.bookings, {
      uid,
      event_type_id: String(eventType.Id),
      user_id: String(user.Id),
      attendee_name,
      attendee_email,
      attendee_timezone,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status: 'confirmed',
      notes: notes || '',
      custom_responses: custom_responses ? JSON.stringify(custom_responses) : null,
      cancel_token,
      reschedule_token,
      created_at: new Date().toISOString(),
    });

    // Fire webhook
    await fireWebhook(eventType.webhook_url, {
      event: 'booking.created',
      booking: { uid, attendee_name, attendee_email, start_time, end_time: end.toISOString() },
    });

    // Create Google Calendar event (non-blocking)
    try {
      const gcalEvent = await createCalendarEvent(user.Id, {
        title: `${eventType.title} with ${attendee_name}`,
        description: notes || '',
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        attendeeEmail: attendee_email,
        attendeeName: attendee_name,
        location: eventType.location || '',
      });
      if (gcalEvent?.id) {
        await db.update(tables.bookings, booking.Id, { google_event_id: gcalEvent.id });
      }
    } catch (e) { fastify.log.error('Google Calendar event creation failed:', e.message); }

    // Send confirmation email
    const cancelUrl = `https://${process.env.BASE_DOMAIN || 'schedkit.net'}/v1/cancel/${cancel_token}`;
    const rescheduleUrl = `https://${process.env.BASE_DOMAIN || 'schedkit.net'}/v1/reschedule/${reschedule_token}`;

    // Check client flag
    let flag = null;
    try {
      const flagResult = await db.find(tables.client_flags,
        `(flagged_by,eq,${user.Id})~and(email,eq,${attendee_email})`);
      flag = flagResult.list?.[0] || null;
    } catch(e) { /* non-fatal */ }

    await sendBookingConfirmation({
      attendee_name,
      attendee_email,
      host_name: user.name || username,
      host_email: user.email,
      event_title: eventType.title,
      start_time: start.toISOString(),
      timezone: attendee_timezone,
      cancel_url: cancelUrl,
      reschedule_url: rescheduleUrl,
      flag,
    });

    // Push notification
    notifyNewBooking(user, { attendee_name, attendee_email, start_time: start.toISOString() }, eventType).catch(() => {});

    return reply.code(201).send({
      uid,
      status: 'confirmed',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      cancel_url: `/cancel/${cancel_token}`,
      reschedule_url: `/reschedule/${reschedule_token}`,
    });
  });

  // PUBLIC: Cancel booking (POST — API)
  // API: Cancel booking by token (used by API clients)
  fastify.post('/cancel/:token', async (req, reply) => {
    const result = await db.find(tables.bookings, `(cancel_token,eq,${req.params.token})`);
    if (!result.list?.length) return reply.code(404).send({ error: 'Invalid token' });
    const booking = result.list[0];
    if (booking.status === 'cancelled') return reply.code(400).send({ error: 'Already cancelled' });
    await db.update(tables.bookings, booking.Id, { status: 'cancelled' });
    const et = await db.get(tables.event_types, booking.event_type_id);
    const user = await db.get(tables.users, booking.user_id);

    // Delete Google Calendar event if exists
    if (booking.google_event_id && user?.Id) {
      try { await deleteCalendarEvent(user.Id, booking.google_event_id); } catch(e) { /* non-fatal */ }
    }
    await fireWebhook(et?.webhook_url, { event: 'booking.cancelled', booking: { uid: booking.uid } });
    try {
      await sendCancellationEmail({
        attendee_name: booking.attendee_name, attendee_email: booking.attendee_email,
        host_name: user?.name || 'your host', event_title: et?.title || 'Meeting',
        appointment_label: et?.appointment_label || 'meeting',
        start_time: booking.start_time, timezone: booking.attendee_timezone || 'UTC',
      });
    } catch(e) { fastify.log.error('Cancel email failed:', e.message); }
    if (user) notifyBookingCancelled(user, booking, et || {}).catch(() => {});
    return { status: 'cancelled', uid: booking.uid };
  });

  // PUBLIC: Cancel booking (GET — "Are you sure?" page)
  fastify.get('/cancel/:token', async (req, reply) => {
    const result = await db.find(tables.bookings, `(cancel_token,eq,${req.params.token})`);
    if (!result.list?.length) return reply.type('text/html').send(resultPage('⚠️', 'Invalid or expired cancellation link.', null));
    const booking = result.list[0];
    if (booking.status === 'cancelled') return reply.type('text/html').send(resultPage('⚠️', 'This booking has already been cancelled.', booking));
    const et = await db.get(tables.event_types, booking.event_type_id);
    return reply.type('text/html').send(confirmCancelPage(booking, et));
  });

  // PUBLIC: Cancel booking (POST — confirmed)
  fastify.post('/cancel/:token/confirm', async (req, reply) => {
    const result = await db.find(tables.bookings, `(cancel_token,eq,${req.params.token})`);
    if (!result.list?.length) return reply.type('text/html').send(resultPage('⚠️', 'Invalid or expired cancellation link.', null));
    const booking = result.list[0];
    if (booking.status === 'cancelled') return reply.type('text/html').send(resultPage('⚠️', 'Already cancelled.', booking));
    await db.update(tables.bookings, booking.Id, { status: 'cancelled' });
    const et = await db.get(tables.event_types, booking.event_type_id);
    const user = await db.get(tables.users, booking.user_id);
    await fireWebhook(et?.webhook_url, { event: 'booking.cancelled', booking: { uid: booking.uid } });
    try {
      await sendCancellationEmail({
        attendee_name: booking.attendee_name, attendee_email: booking.attendee_email,
        host_name: user?.name || 'your host', event_title: et?.title || 'Meeting',
        appointment_label: et?.appointment_label || 'meeting',
        start_time: booking.start_time, timezone: booking.attendee_timezone || 'UTC',
      });
    } catch(e) { fastify.log.error('Cancel email (confirm) failed:', e.message); }
    return reply.type('text/html').send(resultPage('✅', 'Your booking has been cancelled.', booking));
  });

  // PUBLIC: Reschedule (GET — shows booking page with context)
  fastify.get('/reschedule/:token', async (req, reply) => {
    const result = await db.find(tables.bookings, `(reschedule_token,eq,${req.params.token})`);
    if (!result.list?.length) return reply.type('text/html').send(resultPage('⚠️', 'Invalid or expired reschedule link.', null));
    const booking = result.list[0];
    if (booking.status === 'cancelled') return reply.type('text/html').send(resultPage('⚠️', 'This booking has been cancelled and cannot be rescheduled.', booking));

    // Look up user slug and event slug
    const user = await db.get(tables.users, booking.user_id);
    const et = await db.get(tables.event_types, booking.event_type_id);
    if (!user || !et) return reply.type('text/html').send(resultPage('⚠️', 'Booking details not found.', null));

    return reply.type('text/html').send(reschedulePage(booking, user, et, req.params.token));
  });

  // PUBLIC: Reschedule (POST — cancel old, create new)
  fastify.post('/reschedule/:token', async (req, reply) => {
    const { start_time, attendee_timezone = 'UTC' } = req.body;
    if (!start_time) return reply.code(400).send({ error: 'start_time required' });

    const result = await db.find(tables.bookings, `(reschedule_token,eq,${req.params.token})`);
    if (!result.list?.length) return reply.code(404).send({ error: 'Invalid token' });
    const oldBooking = result.list[0];
    if (oldBooking.status === 'cancelled') return reply.code(400).send({ error: 'Booking already cancelled' });

    const et = await db.get(tables.event_types, oldBooking.event_type_id);
    const user = await db.get(tables.users, oldBooking.user_id);

    const start = parseISO(start_time);
    const end = addMinutes(start, et.duration_minutes);

    // Conflict check (exclude self)
    const existing = await db.find(tables.bookings, `(user_id,eq,${oldBooking.user_id})~and(status,eq,confirmed)`);
    const conflict = (existing.list || []).some(b => {
      if (b.Id === oldBooking.Id) return false;
      const bStart = new Date(b.start_time).getTime();
      const bEnd = new Date(b.end_time).getTime();
      return bStart < end.getTime() && bEnd > start.getTime();
    });
    if (conflict) return reply.code(409).send({ error: 'Time slot no longer available' });

    // Cancel old, create new
    await db.update(tables.bookings, oldBooking.Id, { status: 'cancelled' });

    const uid = nanoid(12);
    const cancel_token = nanoid(24);
    const reschedule_token = nanoid(24);

    await db.create(tables.bookings, {
      uid,
      event_type_id: String(et.Id),
      user_id: String(oldBooking.user_id),
      attendee_name: oldBooking.attendee_name,
      attendee_email: oldBooking.attendee_email,
      attendee_timezone,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status: 'confirmed',
      notes: oldBooking.notes || '',
      cancel_token,
      reschedule_token,
      created_at: new Date().toISOString(),
    });

    const cancelUrl = `https://${process.env.BASE_DOMAIN || 'schedkit.net'}/v1/cancel/${cancel_token}`;
    await sendBookingConfirmation({
      attendee_name: oldBooking.attendee_name,
      attendee_email: oldBooking.attendee_email,
      host_name: user?.name || 'Host',
      event_title: et.title,
      start_time: start.toISOString(),
      timezone: attendee_timezone,
      cancel_url: cancelUrl,
    });

    return reply.send({ status: 'rescheduled', uid, start_time: start.toISOString(), end_time: end.toISOString(), cancel_url: `/v1/cancel/${cancel_token}`, reschedule_url: `/v1/reschedule/${reschedule_token}` });
  });
}

function shell(title, body) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&family=Fira+Code&display=swap" rel="stylesheet">
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{background:#0a0a0b;font-family:'Space Grotesk',system-ui,sans-serif;color:#e8e8ea;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .brand{font-family:'Fira Code',monospace;color:#DFFF00;font-size:12px;letter-spacing:0.1em;margin-bottom:32px;opacity:0.7}
  .card{background:#111114;border:1px solid #1e1e24;border-radius:12px;padding:40px 36px;text-align:center;max-width:440px;width:100%}
  .icon{font-size:44px;margin-bottom:16px}
  h2{font-size:20px;font-weight:600;margin-bottom:8px}
  .sub{color:#5a5a6e;font-size:14px;line-height:1.5;margin-bottom:4px}
  .uid{font-family:'Fira Code',monospace;color:#DFFF00;font-size:12px;margin-top:12px}
  .time{font-family:'Fira Code',monospace;color:#e8e8ea;font-size:13px;margin:16px 0;background:#0a0a0b;border:1px solid #1e1e24;border-radius:8px;padding:12px 16px}
  .actions{display:flex;flex-direction:column;gap:10px;margin-top:24px}
  .btn{padding:12px 20px;border-radius:8px;font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:600;cursor:pointer;border:none;transition:opacity 0.15s}
  .btn-danger{background:#ff5f5f;color:#fff}
  .btn-danger:hover{opacity:0.85}
  .btn-ghost{background:none;border:1px solid #1e1e24;color:#5a5a6e}
  .btn-ghost:hover{border-color:#5a5a6e;color:#e8e8ea}
  .btn-accent{background:#DFFF00;color:#0a0a0b}
  .btn-accent:hover{opacity:0.9}
</style></head>
<body>
<div class="brand">// schedkit</div>
<div class="card">${body}</div>
</body></html>`;
}

function confirmCancelPage(booking, et) {
  const startLocal = new Date(booking.start_time).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: booking.attendee_timezone || 'UTC',
  });
  return shell('Cancel Booking', `
    <div class="icon">🗓️</div>
    <h2>Cancel this booking?</h2>
    <p class="sub">You're about to cancel your meeting with <strong>${et?.title || 'your host'}</strong>.</p>
    <div class="time">${startLocal}<br><small style="color:#5a5a6e">${booking.attendee_timezone || 'UTC'}</small></div>
    <p class="sub">This cannot be undone. You will need to book again if you change your mind.</p>
    <div class="actions">
      <form method="POST" action="/v1/cancel/${booking.cancel_token}/confirm">
        <button type="submit" class="btn btn-danger" style="width:100%">Yes, cancel my booking</button>
      </form>
      <button class="btn btn-ghost" onclick="history.back()">← Go back</button>
    </div>
  `);
}

function resultPage(icon, message, booking) {
  const detail = booking ? `<div class="uid">Booking ID: ${booking.uid}</div>` : '';
  return shell(message, `
    <div class="icon">${icon}</div>
    <h2>${message}</h2>
    ${detail}
  `);
}

function reschedulePage(booking, user, et, token) {
  const startLocal = new Date(booking.start_time).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: booking.attendee_timezone || 'UTC',
  });
  return shell('Reschedule Booking', `
    <div class="icon">🔄</div>
    <h2>Reschedule your booking</h2>
    <p class="sub">Currently scheduled for:</p>
    <div class="time">${startLocal}</div>
    <p class="sub" style="margin-bottom:20px">Pick a new time below. Your old slot will be released.</p>
    <div class="actions">
      <a href="/book/${user.slug}/${et.slug}?reschedule=${token}&name=${encodeURIComponent(booking.attendee_name)}&email=${encodeURIComponent(booking.attendee_email)}&tz=${encodeURIComponent(booking.attendee_timezone || 'UTC')}">
        <button class="btn btn-accent" style="width:100%">Pick a new time →</button>
      </a>
      <button class="btn btn-ghost" onclick="history.back()">← Go back</button>
    </div>
  `);
}
