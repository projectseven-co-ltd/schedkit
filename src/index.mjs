import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import staticFiles from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import rateLimit from '@fastify/rate-limit';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_VERSION = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')).version;
const GIT_SHA = (() => { try { return readFileSync(join(__dirname, '../.git-sha'), 'utf8').trim(); } catch { try { return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim(); } catch { return 'unknown'; } } })();
import { ensureSchema } from './lib/schema.mjs';
import { meta } from './lib/noco.mjs';
import { tables } from './lib/tables.mjs';
import eventTypesRoutes from './routes/eventTypes.mjs';
import availabilityRoutes from './routes/availability.mjs';
import bookingsRoutes from './routes/bookings.mjs';
import usersRoutes from './routes/users.mjs';
import bookingPageRoutes from './routes/bookingPage.mjs';
import blackoutRoutes from './routes/blackout.mjs';
import authRoutes from './routes/auth.mjs';
import clientFlagRoutes from './routes/clientFlags.mjs';
import orgsRoutes from './routes/orgs.mjs';
import teamSlotsRoutes from './routes/teamSlots.mjs';
import teamBookingPageRoutes from './routes/teamBookingPage.mjs';
import calendarRoutes from './routes/calendar.mjs';
import notificationRoutes from './routes/notifications.mjs';
import pushRoutes from './routes/push.mjs';
import signalsRoutes from './routes/signals.mjs';
import ticketsRoutes from './routes/tickets.mjs';
import incidentsRoutes from './routes/incidents.mjs';
import warRoomRoutes from './routes/warRoom.mjs';
import incidentStatusRoutes from './routes/incidentStatus.mjs';
import settingsRoutes from './routes/settings.mjs';
import uploadsRoutes from './routes/uploads.mjs';
import billingRoutes from './routes/billing.mjs';

const fastify = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 }); // 10MB for image captures

await fastify.register(cors, { origin: true });
await fastify.register(formbody);

// Global rate limit — 200 req/min per IP by default, tightened per-route on auth/sensitive endpoints
await fastify.register(rateLimit, {
  global: true,
  max: 200,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
});

// Raw body access for Stripe webhook signature verification
fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  req.rawBody = body;
  try { done(null, JSON.parse(body)); } catch (e) { done(e); }
});

// Swagger
await fastify.register(swagger, {
  transform: ({ schema, url, route }) => {
    if (!schema) schema = {};
    const method = route?.method;
    const m = Array.isArray(method) ? method[0] : method;
    if (!schema.operationId && m && url) {
      const id = (m.toLowerCase() + url.replace(/\//g, '_').replace(/[{}]/g, '').replace(/_+/g, '_').replace(/_$/, '')).replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
      schema = { ...schema, operationId: id };
    }
    return { schema, url };
  },
  openapi: {
    info: {
      title: 'SchedKit API',
      description: `**SchedKit** is an API-first white-label scheduling platform.\n\nAll endpoints require authentication via **\`x-api-key\`** (user API key) or **\`x-admin-secret\`** (admin) unless tagged **Public**.\n\n### Quick start\n1. Get your API key from the dashboard → Settings\n2. Pass it as \`x-api-key: YOUR_KEY\` on every request\n3. Create an event type, set your availability, share your booking link\n\n### Tags\n- **Event Types** — Define bookable event types (duration, buffer, confirmation requirements)\n- **Availability** — Set weekly recurring availability windows\n- **Bookings** — View, reschedule, cancel, confirm/decline bookings\n- **Auth** — Magic link login, session management\n- **Public** — Unauthenticated endpoints (booking slots, booking page data)`,
      version: '1.0.0',
    },
    tags: [
      { name: 'Event Types', description: 'Create and manage bookable event types. Each event type has a slug used in the public booking URL (`/book/:username/:slug`). Set `requires_confirmation: true` to hold bookings as pending until you manually accept or decline.' },
      { name: 'Availability', description: 'Define your weekly recurring availability. Rules are per day-of-week with a start/end time in HH:MM format. The slots engine uses these rules minus existing bookings and blocked times.' },
      { name: 'Bookings', description: 'List, retrieve, reschedule, cancel, confirm, or decline bookings. Bookings with `status=pending` are awaiting host confirmation (requires_confirmation flow).' },
      { name: 'Auth', description: 'Magic link authentication. Request a login link via email, verify it to get a session, or use API keys for programmatic access.' },
      { name: 'Public', description: 'Unauthenticated endpoints used by the booking page — available slots, booking submission, cancellation/reschedule via token.' },
      { name: 'Blackout Dates', description: 'Block specific dates or date ranges from accepting bookings.' },
      { name: 'Clients', description: 'Client risk flags — mark clients as caution, high-risk, or blocked. Flags appear in host notification emails.' },
      { name: 'Notifications', description: 'Configure ntfy.sh push notification topics for new bookings.' },
      { name: 'Organizations', description: 'Multi-user org and team management. Invite members, create shared team event types.' },
      { name: 'Calendar', description: 'Google Calendar OAuth connection for two-way sync.' },
      { name: 'Users', description: 'User profile and API key management.' },
      { name: 'Tickets', description: 'Ticket and incident management. **Tickets and incidents are the same object** — every record is accessible via both `/v1/tickets` (async/helpdesk) and `/v1/incidents` (real-time SSE/dispatch). The `source` field (`api`, `email`, `webhook`, `alert`) and `priority` together imply context. Neither endpoint enforces a use case.' },
      { name: 'Incidents', description: 'Real-time incident coordination layer. **Same underlying records as `/v1/tickets`** — no separate table. Adds SSE streaming, responder management, and reply threads on top of the ticket object. Use `/v1/incidents` for ops war rooms, dispatch systems, or alert pipelines. Use `/v1/tickets` for helpdesk or ITSM flows. Both share identical data.' },
      { name: 'Settings', description: 'User settings management. Get or update per-user configuration — currently `ntfy_topic` for push notifications via ntfy.sh.' },
    ],
    servers: [{ url: 'https://schedkit.net', description: 'Production' }],
    components: {
      securitySchemes: {
        apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
        adminSecret: { type: 'apiKey', in: 'header', name: 'x-admin-secret' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'sk_session' },
      },
    },
  },
});

await fastify.register(swaggerUi, {
  routePrefix: '/docs',
  uiConfig: { docExpansion: 'none', deepLinking: true, defaultModelsExpandDepth: 0, displayRequestDuration: true },
  logo: { type: 'image/png', content: readFileSync(join(__dirname, '../public/logo.png')) },
  theme: {
    title: '\\\\ SchedKit API',
    css: [{ filename: 'docs.css', content: `
      body { background: #0a0a0b !important; }
      .swagger-ui { background: #0a0a0b; color: #e8e8ea; }
      .swagger-ui .topbar { background: #111114; border-bottom: 1px solid #1e1e24; padding: 10px 0; }
      .swagger-ui .topbar-wrapper { gap: 12px; }
      .swagger-ui .topbar-wrapper img { height: 32px; width: 32px; }
      .swagger-ui .topbar .download-url-wrapper .download-url-button { background: #DFFF00; color: #0a0a0b; }
      .swagger-ui .info .title { color: #DFFF00; font-family: monospace; }
      .swagger-ui .scheme-container { background: #111114; border: 1px solid #1e1e24; }
      .swagger-ui .opblock-tag { color: #e8e8ea; border-bottom: 1px solid #1e1e24; }
      .swagger-ui .opblock { background: #111114; border: 1px solid #1e1e24; }
      .swagger-ui .opblock .opblock-summary { background: #0a0a0b; }
    `}],
  },
});

// Static (landing page) — must come after swagger
await fastify.register(staticFiles, { root: join(__dirname, '../public'), prefix: '/' });

// Ensure NocoDB schema exists
await ensureSchema();

// Load table ID map
const tableList = await meta.getTables();
for (const t of tableList.list) {
  tables[t.title] = t.id;
}
console.log('Tables loaded:', Object.keys(tables));

// Routes
await fastify.register(usersRoutes, { prefix: '/v1' });
await fastify.register(eventTypesRoutes, { prefix: '/v1' });
await fastify.register(availabilityRoutes, { prefix: '/v1' });
await fastify.register(bookingsRoutes, { prefix: '/v1' });
await fastify.register(blackoutRoutes, { prefix: '/v1' });
await fastify.register(authRoutes, { prefix: '/v1' });
await fastify.register(clientFlagRoutes, { prefix: '/v1' });
await fastify.register(orgsRoutes, { prefix: '/v1' });
await fastify.register(teamSlotsRoutes, { prefix: '/v1' });
await fastify.register(bookingPageRoutes);
await fastify.register(teamBookingPageRoutes);
await fastify.register(calendarRoutes, { prefix: '/v1' });
await fastify.register(notificationRoutes, { prefix: '/v1' });
await fastify.register(pushRoutes, { prefix: '/v1' });
await fastify.register(signalsRoutes, { prefix: '/v1' });
await fastify.register(ticketsRoutes, { prefix: '/v1' });
await fastify.register(incidentsRoutes, { prefix: '/v1' });
await fastify.register(warRoomRoutes);
await fastify.register(incidentStatusRoutes);
await fastify.register(settingsRoutes, { prefix: '/v1' });

// Register binary content type parser for image uploads
fastify.addContentTypeParser('image/jpeg', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
fastify.addContentTypeParser('image/webp', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
fastify.addContentTypeParser('image/png', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

await fastify.register(uploadsRoutes, { prefix: '/v1' });
await fastify.register(billingRoutes, { prefix: '/v1' });

// Page routes (no prefix)
fastify.get('/login', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { hide: true } }, async (req, reply) => {
  const { readFileSync } = await import('fs');
  return reply.type('text/html').send(readFileSync(join(__dirname, '../public/login.html')));
});
fastify.get('/google-callback', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { hide: true } }, async (req, reply) => {
  const { readFileSync } = await import('fs');
  return reply.type('text/html').send(readFileSync(join(__dirname, '../public/google-callback.html')));
});
fastify.get('/dashboard', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { hide: true } }, async (req, reply) => {
  const { readFileSync } = await import('fs');
  return reply.type('text/html').send(readFileSync(join(__dirname, '../public/dashboard.html')));
});

fastify.get('/olson', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { hide: true } }, async (req, reply) => {
  return reply.type('text/html').send(readFileSync(join(__dirname, '../public/olson.html')));
});

fastify.get('/onboarding', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { hide: true } }, async (req, reply) => {
  const { readFileSync } = await import('fs');
  return reply.type('text/html').send(readFileSync(join(__dirname, '../public/onboarding.html')));
});

fastify.get('/signals', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { hide: true } }, async (req, reply) => {
  const { readFileSync } = await import('fs');
  return reply.type('text/html').send(readFileSync(join(__dirname, '../public/signals.html')));
});

// 404 handler
fastify.setNotFoundHandler(async (req, reply) => {
  const { readFileSync } = await import('fs');
  return reply.code(404).type('text/html').send(readFileSync(join(__dirname, '../public/404.html')));
});

// Health
fastify.get('/health', {
  schema: {
    tags: ['System'],
    summary: 'Health check',
    response: { 200: { type: 'object', properties: { status: { type: 'string' }, service: { type: 'string' } } } },
  },
}, () => ({ status: 'ok', service: 'p7-scheduler' }));

// Version
fastify.get('/version', {
  schema: {
    tags: ['System'],
    summary: 'Service version',
    response: { 200: { type: 'object', properties: { version: { type: 'string' }, commit: { type: 'string' } } } },
  },
}, () => ({ version: PKG_VERSION, commit: GIT_SHA }));

// Request access
fastify.post('/v1/request-access', {
  schema: {
    tags: ['System'],
    summary: 'Request early access',
    body: {
      type: 'object',
      required: ['name', 'email'],
      properties: {
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        company: { type: 'string' },
        message: { type: 'string' },
        plan: { type: 'string', enum: ['free', 'starter', 'agency', 'enterprise'] },
      },
    },
  },
}, async (req, reply) => {
  const { name, email, company, message, plan = 'free' } = req.body || {};
  if (!name || !email) return reply.code(400).send({ error: 'Name and email required' });
  try {
    // 1. Save to NocoDB leads table
    const { db } = await import('./lib/noco.mjs');
    await db.create('m7cck1nc79fliq7', {
      name, email,
      company: company || '',
      message: message || '',
      plan: plan,
      status: plan === 'free' ? 'approved' : 'new',
      submitted_at: new Date().toISOString(),
    });

    // 2. ntfy alert
    const ntfyTopic = process.env.NTFY_TOPIC || 'schedkit-leads';
    const planLabel = plan.toUpperCase();
    fetch(`https://ntfy.sh/${ntfyTopic}`, {
      method: 'POST',
      headers: {
        'Title': `[${planLabel}] New SchedKit Signup: ${name}${company ? ' - ' + company : ''}`,
        'Priority': plan === 'free' ? 'default' : 'high',
        'Tags': 'schedkit,lead',
        'Content-Type': 'text/plain',
      },
      body: `${name} <${email}>${company ? '\n' + company : ''}\nPlan: ${planLabel}\n\n${message || '(no message)'}`,
    }).catch(e => fastify.log.warn('ntfy alert failed: ' + e.message));

    const { sendAccessRequest, sendWelcome } = await import('./lib/mailer.mjs');
    const { tables } = await import('./lib/tables.mjs');

    if (plan === 'free') {
      // Free tier: create/update user account with plan=free
      const existing = await db.find(tables.users, `(email,eq,${email})`);
      if (existing.list?.length) {
        await db.update(tables.users, existing.list[0].Id, { plan: 'free' });
      } else {
        const { nanoid } = await import('nanoid');
        const slug = email.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase() + '-' + nanoid(4).toLowerCase();
        await db.create(tables.users, {
          name, email, slug,
          api_key: `p7s_${nanoid(32)}`,
          plan: 'free',
          active: true,
          created_at: new Date().toISOString(),
        });
      }
      await sendWelcome({ name, email });
    } else {
      // Paid tiers: notify Jason
      await sendAccessRequest({ name, email, company, message, plan });
    }

    return { ok: true };
  } catch(e) {
    fastify.log.error(e);
    return reply.code(500).send({ error: 'Failed to send' });
  }
});

const port = Number(process.env.PORT || 3000);
await fastify.listen({ port, host: '0.0.0.0' });
console.log(`p7-scheduler running on :${port}`);
