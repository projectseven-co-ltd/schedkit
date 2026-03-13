// src/routes/settings.mjs — User settings API
// GET /v1/settings  — returns current user settings (ntfy_topic, plan, email)
// PATCH /v1/settings — update ntfy_topic (validated slug)

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireApiKey } from '../middleware/auth.mjs';
import { requireSession } from '../middleware/session.mjs';

async function requireAuth(req, reply) {
  if (req.headers['x-api-key']) return requireApiKey(req, reply);
  return requireSession(req, reply);
}

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export default async function settingsRoutes(fastify) {
  // GET /v1/settings — return current user settings
  fastify.get('/settings', {
    preHandler: requireAuth,
    schema: {
      tags: ['Settings'],
      summary: 'Get user settings',
      description: 'Returns the authenticated user\'s settings: `ntfy_topic`, `plan`, and `email`. Auth via `x-api-key` or session cookie.',
      security: [{ apiKey: [] }, { cookieAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'User email address' },
            plan: { type: 'string', description: 'Subscription plan (free, pro, enterprise)' },
            ntfy_topic: { type: 'string', description: 'ntfy.sh topic slug for push notifications' },
          },
        },
      },
    },
  }, async (req) => {
    const { email, plan, ntfy_topic } = req.user;
    return {
      email: email || '',
      plan: plan || 'free',
      ntfy_topic: ntfy_topic || '',
    };
  });

  // PATCH /v1/settings — update user settings
  fastify.patch('/settings', {
    preHandler: requireAuth,
    schema: {
      tags: ['Settings'],
      summary: 'Update user settings',
      description: 'Update the authenticated user\'s settings. Currently supports `ntfy_topic` — a valid ntfy.sh slug (alphanumeric, hyphens, underscores, max 64 chars). Set to empty string `""` to clear.',
      security: [{ apiKey: [] }, { cookieAuth: [] }],
      body: {
        type: 'object',
        properties: {
          ntfy_topic: {
            type: 'string',
            description: 'ntfy.sh topic slug. Must match `[a-zA-Z0-9_-]{1,64}` or be empty to clear.',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            plan: { type: 'string' },
            ntfy_topic: { type: 'string' },
          },
        },
        400: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
      },
    },
  }, async (req, reply) => {
    const updates = {};

    if (req.body.ntfy_topic !== undefined) {
      const topic = req.body.ntfy_topic.trim();
      if (topic !== '' && !SLUG_RE.test(topic)) {
        return reply.code(400).send({
          error: 'ntfy_topic must be alphanumeric with hyphens/underscores, max 64 chars',
        });
      }
      updates.ntfy_topic = topic;
    }

    if (Object.keys(updates).length > 0) {
      await db.update(tables.users, req.user.Id, updates);
    }

    // Return fresh settings
    const updated = await db.get(tables.users, req.user.Id);
    return {
      email: updated.email || '',
      plan: updated.plan || 'free',
      ntfy_topic: updated.ntfy_topic || '',
    };
  });
}
