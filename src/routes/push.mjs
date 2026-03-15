// src/routes/push.mjs — Web Push (VAPID) subscription management
//
// Stores push subscriptions per user in NocoDB.
// On key events (assignment confirmed, incident created, SLA breach),
// other routes call sendPushToUser() to deliver a native push notification.

import webpush from 'web-push';
import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireSession } from '../middleware/session.mjs';

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:ceo@schedkit.net';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

// ── Helpers ───────────────────────────────────────────

async function getSubscriptions(userId) {
  try {
    const result = await db.list(tables.pushSubscriptions, {
      where: `(user_id,eq,${userId})`,
      limit: 20,
    });
    return result.list || [];
  } catch { return []; }
}

export async function sendPushToUser(userId, { title, body, url, tag, requireInteraction, actions, vibrate } = {}) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
  const subs = await getSubscriptions(userId);
  const payload = JSON.stringify({ title, body, url: url || '/dashboard', tag, requireInteraction, actions, vibrate });

  await Promise.allSettled(subs.map(async row => {
    try {
      const subscription = JSON.parse(row.subscription_json);
      await webpush.sendNotification(subscription, payload);
    } catch (err) {
      // 410 Gone = subscription expired/revoked → remove it
      if (err.statusCode === 410 || err.statusCode === 404) {
        try { await db.delete(tables.pushSubscriptions, row.Id); } catch {}
      }
    }
  }));
}

// ── Routes ────────────────────────────────────────────

export default async function pushRoutes(fastify) {

  // GET /v1/push/vapid-public — return public key for client subscription
  fastify.get('/push/vapid-public', {
    schema: {
      tags: ['Push'],
      summary: 'Get VAPID public key',
      description: 'Return the public VAPID key the browser needs to create a Web Push subscription.',
      response: {
        200: {
          type: 'object',
          properties: { publicKey: { type: ['string', 'null'] } },
          example: { publicKey: 'BIa_HKGuR_doeyRcqmP3qSRqznWQin-oPIJlSk1Mk08-yBSqeB8w932fH-f66YTFLMhUzeHzP_VHNEwMXIFmG4k' },
        },
      },
    },
  }, async () => {
    return { publicKey: VAPID_PUBLIC || null };
  });

  // POST /v1/push/subscribe — save a push subscription for the current user
  fastify.post('/push/subscribe', {
    preHandler: requireSession,
    schema: {
      tags: ['Push'],
      summary: 'Register a Web Push subscription',
      description: 'Store or update a browser PushSubscription for the current user so SchedKit can send native notifications.',
      body: {
        type: 'object',
        required: ['subscription'],
        properties: {
          subscription: { type: 'object', description: 'PushSubscription JSON from browser' },
        },
        examples: [{
          subscription: {
            endpoint: 'https://fcm.googleapis.com/fcm/send/example-subscription-id',
            expirationTime: null,
            keys: { p256dh: 'BExamplePublicKey', auth: 'exampleAuthSecret' },
          },
        }],
      },
      response: { 200: { type: 'object', properties: { ok: { type: 'boolean' } }, example: { ok: true } } },
    },
  }, async (req, reply) => {
    const { subscription } = req.body;
    if (!subscription?.endpoint) return reply.code(400).send({ error: 'invalid subscription' });

    const userId = req.user.Id;
    const endpoint = subscription.endpoint;

    // Upsert — check if endpoint already stored
    const existing = await db.list(tables.pushSubscriptions, {
      where: `(user_id,eq,${userId})~and(endpoint,eq,${endpoint})`,
      limit: 1,
    });

    if (existing.list?.length) {
      // Update subscription keys (they can rotate)
      await db.update(tables.pushSubscriptions, existing.list[0].Id, {
        subscription_json: JSON.stringify(subscription),
        updated_at: new Date().toISOString(),
      });
    } else {
      await db.create(tables.pushSubscriptions, {
        user_id: userId,
        endpoint,
        subscription_json: JSON.stringify(subscription),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    return { ok: true };
  });

  // DELETE /v1/push/subscribe — remove a subscription
  fastify.delete('/push/subscribe', {
    preHandler: requireSession,
    schema: {
      tags: ['Push'],
      summary: 'Remove a Web Push subscription',
      description: 'Delete a stored Web Push subscription for the current user, usually during logout or opt-out.',
      body: {
        type: 'object',
        required: ['endpoint'],
        properties: { endpoint: { type: 'string' } },
        examples: [{ endpoint: 'https://fcm.googleapis.com/fcm/send/example-subscription-id' }],
      },
      response: { 200: { type: 'object', properties: { ok: { type: 'boolean' } }, example: { ok: true } } },
    },
  }, async (req, reply) => {
    const { endpoint } = req.body;
    const userId = req.user.Id;
    const existing = await db.list(tables.pushSubscriptions, {
      where: `(user_id,eq,${userId})~and(endpoint,eq,${endpoint})`,
      limit: 1,
    });
    if (existing.list?.length) {
      await db.delete(tables.pushSubscriptions, existing.list[0].Id);
    }
    return { ok: true };
  });

  // POST /v1/push/test — send a test push to self
  fastify.post('/push/test', {
    preHandler: requireSession,
    schema: {
      tags: ['Push'],
      summary: 'Send a test push notification to yourself',
      description: 'Send a test push to all saved subscriptions for the current user. Useful for validating permission and delivery.',
      response: { 200: { type: 'object', properties: { ok: { type: 'boolean' }, sent: { type: 'integer' } }, example: { ok: true, sent: 2 } } },
    },
  }, async (req) => {
    const subs = await getSubscriptions(req.user.Id);
    if (!subs.length) return { ok: false, sent: 0 };
    await sendPushToUser(req.user.Id, {
      title: '[+] SchedKit',
      body: 'Push notifications are working. SITREP online.',
      url: '/dashboard',
      tag: 'test',
    });
    return { ok: true, sent: subs.length };
  });
}
