// src/routes/bookings.js

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireApiKey } from '../middleware/auth.mjs';
import { addMinutes, parseISO } from 'date-fns';
import { nanoid } from 'nanoid';
import { sendBookingConfirmation } from '../lib/mailer.mjs';

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
  fastify.get('/bookings', { preHandler: requireApiKey }, async (req) => {
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
  fastify.get('/bookings/:id', { preHandler: requireApiKey }, async (req, reply) => {
    const row = await db.get(tables.bookings, req.params.id);
    if (!row || row.user_id != req.user.Id) return reply.code(404).send({ error: 'Not found' });
    return row;
  });

  // PUBLIC: Create booking
  // POST /book/:username/:event_slug
  fastify.post('/book/:username/:event_slug', async (req, reply) => {
    const { username, event_slug } = req.params;
    const { start_time, attendee_name, attendee_email, attendee_timezone = 'UTC', notes } = req.body;

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

    const start = parseISO(start_time);
    const end = addMinutes(start, eventType.duration_minutes);

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
      cancel_token,
      reschedule_token,
      created_at: new Date().toISOString(),
    });

    // Fire webhook
    await fireWebhook(eventType.webhook_url, {
      event: 'booking.created',
      booking: { uid, attendee_name, attendee_email, start_time, end_time: end.toISOString() },
    });

    // Send confirmation email
    const cancelUrl = `https://${process.env.BASE_DOMAIN || 'schedkit.net'}/v1/cancel/${cancel_token}`;
    await sendBookingConfirmation({
      attendee_name,
      attendee_email,
      host_name: user.name || username,
      event_title: eventType.title,
      start_time: start.toISOString(),
      timezone: attendee_timezone,
      cancel_url: cancelUrl,
    });

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
  fastify.post('/cancel/:token', async (req, reply) => {
    const result = await db.find(tables.bookings, `(cancel_token,eq,${req.params.token})`);
    if (!result.list?.length) return reply.code(404).send({ error: 'Invalid token' });
    const booking = result.list[0];
    if (booking.status === 'cancelled') return reply.code(400).send({ error: 'Already cancelled' });
    await db.update(tables.bookings, booking.Id, { status: 'cancelled' });
    const et = await db.get(tables.event_types, booking.event_type_id);
    await fireWebhook(et?.webhook_url, { event: 'booking.cancelled', booking: { uid: booking.uid } });
    return { status: 'cancelled', uid: booking.uid };
  });

  // PUBLIC: Cancel booking (GET — email link click)
  fastify.get('/cancel/:token', async (req, reply) => {
    const result = await db.find(tables.bookings, `(cancel_token,eq,${req.params.token})`);
    if (!result.list?.length) {
      return reply.type('text/html').send(cancelPage('Invalid or expired cancellation link.', null, false));
    }
    const booking = result.list[0];
    if (booking.status === 'cancelled') {
      return reply.type('text/html').send(cancelPage('This booking has already been cancelled.', booking, false));
    }
    await db.update(tables.bookings, booking.Id, { status: 'cancelled' });
    const et = await db.get(tables.event_types, booking.event_type_id);
    await fireWebhook(et?.webhook_url, { event: 'booking.cancelled', booking: { uid: booking.uid } });
    return reply.type('text/html').send(cancelPage('Your booking has been cancelled.', booking, true));
  });
}

function cancelPage(message, booking, success) {
  const icon = success ? '✅' : '⚠️';
  const detail = booking ? `<p style="font-family:monospace;color:#DFFF00;margin:12px 0 0;font-size:13px;">Booking ID: ${booking.uid}</p>` : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Booking Cancelled</title>
<style>
  body{margin:0;padding:0;background:#0a0a0b;font-family:'Helvetica Neue',Arial,sans-serif;color:#e8e8ea;display:flex;align-items:center;justify-content:center;min-height:100vh;}
  .card{background:#111114;border:1px solid #1e1e24;border-radius:12px;padding:48px 40px;text-align:center;max-width:420px;width:90%;}
  .icon{font-size:48px;margin-bottom:16px;}
  h2{font-size:20px;font-weight:600;margin:0 0 8px;}
  p{color:#5a5a6e;font-size:14px;margin:0;}
  .brand{font-family:monospace;color:#DFFF00;font-size:11px;margin-top:32px;opacity:0.6;}
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h2>${message}</h2>
    ${detail}
    <div class="brand">// schedkit</div>
  </div>
</body></html>`;
}
