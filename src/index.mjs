import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import staticFiles from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
const __dirname = dirname(fileURLToPath(import.meta.url));
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

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: true });
await fastify.register(formbody);

// Swagger
await fastify.register(swagger, {
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

// Page routes (no prefix)
fastify.get('/login', { schema: { hide: true } }, async (req, reply) => {
  const { readFileSync } = await import('fs');
  return reply.type('text/html').send(readFileSync(join(__dirname, '../public/login.html')));
});
fastify.get('/google-callback', { schema: { hide: true } }, async (req, reply) => {
  const { readFileSync } = await import('fs');
  return reply.type('text/html').send(readFileSync(join(__dirname, '../public/google-callback.html')));
});
fastify.get('/dashboard', { schema: { hide: true } }, async (req, reply) => {
  const { readFileSync } = await import('fs');
  return reply.type('text/html').send(readFileSync(join(__dirname, '../public/dashboard.html')));
});

fastify.get('/onboarding', { schema: { hide: true } }, async (req, reply) => {
  const { readFileSync } = await import('fs');
  return reply.type('text/html').send(readFileSync(join(__dirname, '../public/onboarding.html')));
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
      },
    },
  },
}, async (req, reply) => {
  const { name, email, company, message } = req.body || {};
  if (!name || !email) return reply.code(400).send({ error: 'Name and email required' });
  try {
    // 1. Save to NocoDB leads table
    const { db } = await import('./lib/noco.mjs');
    await db.create('m7cck1nc79fliq7', {
      name, email,
      company: company || '',
      message: message || '',
      status: 'new',
      submitted_at: new Date().toISOString(),
    });

    // 2. ntfy alert
    const ntfyTopic = process.env.NTFY_TOPIC || 'schedkit-leads';
    fetch(`https://ntfy.sh/${ntfyTopic}`, {
      method: 'POST',
      headers: {
        'Title': `New SchedKit Lead: ${name}${company ? ' - ' + company : ''}`,
        'Priority': 'high',
        'Tags': 'schedkit,lead',
        'Content-Type': 'text/plain',
      },
      body: `${name} <${email}>${company ? '\n' + company : ''}\n\n${message || '(no message)'}`,
    }).catch(e => fastify.log.warn('ntfy alert failed: ' + e.message));

    // 3. Email to Jason
    const { sendAccessRequest } = await import('./lib/mailer.mjs');
    await sendAccessRequest({ name, email, company, message });

    return { ok: true };
  } catch(e) {
    fastify.log.error(e);
    return reply.code(500).send({ error: 'Failed to send' });
  }
});

const port = Number(process.env.PORT || 3000);
await fastify.listen({ port, host: '0.0.0.0' });
console.log(`p7-scheduler running on :${port}`);
