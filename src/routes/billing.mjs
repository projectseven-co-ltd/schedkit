// src/routes/billing.mjs — Stripe billing: Subscribe, Customer Portal, Webhook
import Stripe from 'stripe';
import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireSession } from '../middleware/session.mjs';

const PRICE_IDS = {
  starter: process.env.STRIPE_PRICE_STARTER || 'price_1TBMFk3LrZftF9HcDVGFbeMk',
  agency:  process.env.STRIPE_PRICE_AGENCY  || 'price_1TBMFl3LrZftF9HcGXioTpJ2',
};

const PLAN_FROM_PRICE = Object.fromEntries(Object.entries(PRICE_IDS).map(([k,v]) => [v, k]));

export default async function billingRoutes(fastify) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // POST /v1/billing/subscribe — create customer + subscription, return PaymentIntent clientSecret
  fastify.post('/billing/subscribe', {
    preHandler: requireSession,
    schema: {
      tags: ['Billing'],
      summary: 'Start subscription',
      description: 'Creates a Stripe customer and subscription. Returns a PaymentIntent clientSecret for use with Stripe Elements.',
      body: {
        type: 'object',
        required: ['plan'],
        properties: {
          plan: { type: 'string', enum: ['starter', 'agency'] },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            clientSecret: { type: 'string' },
            subscriptionId: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { plan } = req.body;
    const priceId = PRICE_IDS[plan];
    if (!priceId) return reply.code(400).send({ error: 'Invalid plan' });

    const user = req.user;

    // Find or create Stripe customer
    let customerId;
    const existing = await stripe.customers.list({ email: user.email, limit: 1 });
    if (existing.data.length) {
      customerId = existing.data[0].id;
    } else {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: String(user.Id) },
      });
      customerId = customer.id;
    }

    // Create subscription with payment_behavior=default_incomplete to get a PaymentIntent
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      metadata: { user_id: String(user.Id), plan },
    });

    const clientSecret = subscription.latest_invoice.payment_intent.client_secret;
    return { clientSecret, subscriptionId: subscription.id };
  });

  // GET /v1/billing/portal — Stripe Customer Portal
  fastify.get('/billing/portal', {
    preHandler: requireSession,
    schema: {
      tags: ['Billing'],
      summary: 'Open Stripe Customer Portal',
      response: { 200: { type: 'object', properties: { url: { type: 'string' } } } },
    },
  }, async (req, reply) => {
    const user = req.user;
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (!customers.data.length) {
      return reply.code(404).send({ error: 'No billing account found. Subscribe first.' });
    }
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customers.data[0].id,
      return_url: 'https://schedkit.net/dashboard',
    });
    return { url: portalSession.url };
  });

  // POST /v1/billing/webhook — Stripe webhook
  fastify.post('/billing/webhook', {
    schema: { tags: ['Billing'], summary: 'Stripe webhook receiver' },
  }, async (req, reply) => {
    if (webhookSecret) {
      const sig = req.headers['stripe-signature'];
      try {
        stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
      } catch (err) {
        return reply.code(400).send({ error: `Webhook signature invalid: ${err.message}` });
      }
    }

    const event = req.body;

    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      const subId = invoice.subscription;
      if (subId) {
        try {
          const sub = await stripe.subscriptions.retrieve(subId);
          const userId = sub.metadata?.user_id;
          const plan = sub.metadata?.plan;
          if (userId && plan) {
            await db.update(tables.users, userId, { plan });
            fastify.log.info(`Billing: user ${userId} activated ${plan}`);
          }
        } catch (e) {
          fastify.log.error('Billing: failed to activate plan: ' + e.message);
        }
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const userId = sub.metadata?.user_id;
      if (userId) {
        try {
          await db.update(tables.users, userId, { plan: 'free' });
          fastify.log.info(`Billing: user ${userId} downgraded to free`);
        } catch (e) {
          fastify.log.error('Billing: failed to downgrade user: ' + e.message);
        }
      }
    }

    return { received: true };
  });
}
