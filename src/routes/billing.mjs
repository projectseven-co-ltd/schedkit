// src/routes/billing.mjs — Stripe billing: Checkout, Customer Portal, Webhook
import Stripe from 'stripe';
import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireSession } from '../middleware/session.mjs';

const PRICE_IDS = {
  starter: 'price_1TBKt0KY0CpWBxBoWY7QpBga',
  agency:  'price_1TBKt0KY0CpWBxBoi9hNvdRB',
};

const PLAN_FROM_PRICE = Object.fromEntries(Object.entries(PRICE_IDS).map(([k,v]) => [v, k]));

export default async function billingRoutes(fastify) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // POST /v1/billing/checkout — create Stripe Checkout session
  fastify.post('/billing/checkout', {
    preHandler: requireSession,
    schema: {
      tags: ['Billing'],
      summary: 'Create Stripe Checkout session',
      description: 'Creates a Stripe Checkout session for the given plan. Returns a redirect URL.',
      body: {
        type: 'object',
        required: ['plan'],
        properties: {
          plan: { type: 'string', enum: ['starter', 'agency'], description: 'Plan to upgrade to' },
        },
      },
      response: { 200: { type: 'object', properties: { url: { type: 'string' } } } },
    },
  }, async (req, reply) => {
    const { plan } = req.body;
    const priceId = PRICE_IDS[plan];
    if (!priceId) return reply.code(400).send({ error: 'Invalid plan' });

    const user = req.user;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: user.email,
      metadata: { user_id: String(user.Id), plan },
      success_url: `https://schedkit.net/dashboard?billing=success&plan=${plan}`,
      cancel_url: `https://schedkit.net/dashboard?billing=cancelled`,
    });

    return { url: session.url };
  });

  // GET /v1/billing/portal — Stripe Customer Portal (manage/cancel subscription)
  fastify.get('/billing/portal', {
    preHandler: requireSession,
    schema: {
      tags: ['Billing'],
      summary: 'Open Stripe Customer Portal',
      description: 'Returns a URL to the Stripe Customer Portal where users can manage or cancel their subscription.',
      response: { 200: { type: 'object', properties: { url: { type: 'string' } } } },
    },
  }, async (req, reply) => {
    const user = req.user;
    // Find customer by email
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

  // POST /v1/billing/webhook — Stripe webhook handler
  fastify.post('/billing/webhook', {
    config: { rawBody: true }, // need raw body for signature verification
    schema: {
      tags: ['Billing'],
      summary: 'Stripe webhook receiver',
      description: 'Handles checkout.session.completed and customer.subscription.deleted to flip user plan.',
    },
  }, async (req, reply) => {
    if (!webhookSecret) {
      fastify.log.warn('STRIPE_WEBHOOK_SECRET not set — skipping signature verification');
    } else {
      const sig = req.headers['stripe-signature'];
      try {
        stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
      } catch (err) {
        return reply.code(400).send({ error: `Webhook signature invalid: ${err.message}` });
      }
    }

    const event = req.body;

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.metadata?.user_id;
      const plan = session.metadata?.plan;
      if (userId && plan) {
        try {
          await db.update(tables.users, userId, { plan });
          fastify.log.info(`Billing: user ${userId} upgraded to ${plan}`);
        } catch (e) {
          fastify.log.error('Billing: failed to update user plan: ' + e.message);
        }
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      // Subscription cancelled — downgrade to free
      const sub = event.data.object;
      const customerId = sub.customer;
      try {
        const customer = await stripe.customers.retrieve(customerId);
        const email = customer.email;
        if (email) {
          // Find user by email via NocoDB
          const result = await db.find(tables.users, `(email,eq,${email})`, { limit: 1 });
          const user = result?.list?.[0];
          if (user) {
            await db.update(tables.users, user.Id, { plan: 'free' });
            fastify.log.info(`Billing: user ${user.Id} downgraded to free (subscription cancelled)`);
          }
        }
      } catch (e) {
        fastify.log.error('Billing: failed to downgrade user on cancel: ' + e.message);
      }
    }

    return { received: true };
  });
}
