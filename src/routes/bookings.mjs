// src/routes/bookings.js

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireApiKey } from '../middleware/auth.mjs';
import { addMinutes, parseISO } from 'date-fns';
import { nanoid } from 'nanoid';

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

    // Conflict check
    const conflict = await db.list(tables.bookings, {
      where: `(user_id,eq,${user.Id})~and(status,eq,confirmed)~and(start_time,lt,${end.toISOString()})~and(end_time,gt,${start.toISOString()})`,
      limit: 1,
    });
    if (conflict.list?.length) {
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

    return reply.code(201).send({
      uid,
      status: 'confirmed',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      cancel_url: `/cancel/${cancel_token}`,
      reschedule_url: `/reschedule/${reschedule_token}`,
    });
  });

  // PUBLIC: Cancel booking
  fastify.post('/cancel/:token', async (req, reply) => {
    const result = await db.find(tables.bookings, `(cancel_token,eq,${req.params.token})`);
    if (!result.list?.length) return reply.code(404).send({ error: 'Invalid token' });
    const booking = result.list[0];
    if (booking.status === 'cancelled') return reply.code(400).send({ error: 'Already cancelled' });

    await db.update(tables.bookings, booking.Id, { status: 'cancelled' });

    // Fire webhook
    const et = await db.get(tables.event_types, booking.event_type_id);
    await fireWebhook(et?.webhook_url, { event: 'booking.cancelled', booking: { uid: booking.uid } });

    return { status: 'cancelled', uid: booking.uid };
  });
}
