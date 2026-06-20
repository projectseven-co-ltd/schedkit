import { createInboundPortalTicket } from '../lib/portalInboundTicket.mjs';

const TAG = 'Portal';
const INBOUND_SECRET = process.env.PORTAL_INBOUND_SECRET || '';
const DEFAULT_ORG_SLUG = process.env.PORTAL_ORG_SLUG || 'projectseven';

function assertInboundSecret(req, reply) {
  const secret = String(req.headers['x-portal-inbound-secret'] || '');
  if (!INBOUND_SECRET || secret !== INBOUND_SECRET) {
    reply.code(403).send({ success: false, error: 'Forbidden' });
    return false;
  }
  return true;
}

export default async function portalInboundRoutes(fastify) {
  // POST /v1/portal/inbound/ticket — contact form, email worker, trusted integrations
  fastify.post('/inbound/ticket', {
    config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
    schema: {
      tags: [TAG],
      summary: 'Create ticket from contact form or inbound email (shared secret)',
      body: {
        type: 'object',
        required: ['email', 'subject', 'message'],
        properties: {
          org_slug: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
          subject: { type: 'string' },
          message: { type: 'string' },
          source: { type: 'string', enum: ['api', 'email', 'webhook'] },
          source_ref: { type: 'string' },
          department_slug: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        },
      },
    },
  }, async (req, reply) => {
    if (!assertInboundSecret(req, reply)) return;

    try {
      const result = await createInboundPortalTicket({
        orgSlug: req.body?.org_slug || DEFAULT_ORG_SLUG,
        name: req.body?.name,
        email: req.body?.email,
        subject: req.body?.subject,
        message: req.body?.message,
        source: req.body?.source || 'api',
        sourceRef: req.body?.source_ref || null,
        departmentSlug: req.body?.department_slug || null,
        priority: req.body?.priority || 'normal',
      });
      return reply.code(result.duplicate ? 200 : 201).send(result);
    } catch (err) {
      const code = err.statusCode || 500;
      reply.log.warn({ err: err.message }, 'Inbound ticket create failed');
      return reply.code(code).send({ success: false, error: err.message || 'Failed to create ticket' });
    }
  });
}
