// src/routes/notifications.mjs

import { requireSession } from '../middleware/session.mjs';

export default async function notificationRoutes(fastify) {
  // POST /v1/notifications/test — send a test ntfy notification
  fastify.post('/notifications/test', { preHandler: requireSession }, async (req, reply) => {
    const { topic } = req.body || {};
    if (!topic) return reply.code(400).send({ error: 'topic required' });

    const url = topic.startsWith('http') ? topic : `https://ntfy.sh/${topic}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Title': 'SchedKit Test', 'Tags': 'bell,schedkit', 'Priority': 'default' },
      body: 'Your ntfy notifications are working!',
    });
    if (!res.ok) return reply.code(502).send({ error: 'ntfy_failed', status: res.status });
    return { ok: true };
  });
}
