// src/routes/notifications.mjs

import { requireSession } from '../middleware/session.mjs';

export default async function notificationRoutes(fastify) {

  fastify.post('/notifications/test', {
    preHandler: requireSession,
    schema: {
      tags: ['Notifications'],
      summary: 'Send a test notification',
      security: [{ apiKey: [] }],
      description: 'Sends a test push notification to the specified ntfy.sh topic. Use this to verify your ntfy topic is configured correctly.',
      body: {
        type: 'object', required: ['topic'],
        properties: {
          topic: { type: 'string', description: 'ntfy.sh topic name or full URL (e.g. `my-topic` or `https://ntfy.sh/my-topic`)' },
        },
      },
      response: {
        200: { type: 'object', properties: { ok: { type: 'boolean' } } },
      },
    },
  }, async (req, reply) => {
    const { topic } = req.body || {};
    if (!topic) return reply.code(400).send({ error: 'topic required' });

    // SSRF fix: only allow ntfy.sh topics (no arbitrary URLs)
    if (topic.startsWith('http')) return reply.code(400).send({ error: 'invalid_topic', message: 'Topic must be a plain topic name, not a URL' });
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(topic)) return reply.code(400).send({ error: 'invalid_topic', message: 'Topic must be alphanumeric (a-z, 0-9, _, -)' });
    const url = `https://ntfy.sh/${topic}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Title': 'SchedKit Test', 'Tags': 'bell,schedkit', 'Priority': 'default' },
      body: 'Your ntfy notifications are working!',
    });
    if (!res.ok) return reply.code(502).send({ error: 'ntfy_failed', status: res.status });
    return { ok: true };
  });
}
