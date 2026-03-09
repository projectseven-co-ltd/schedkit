import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import staticFiles from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
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

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: true });
await fastify.register(formbody);

// Swagger
await fastify.register(swagger, {
  openapi: {
    info: {
      title: 'SchedKit API',
      description: 'White-label scheduling API. All endpoints require `x-api-key` (user) or `x-admin-secret` (admin) headers unless marked Public.',
      version: '1.0.0',
    },
    servers: [{ url: 'https://schedkit.net', description: 'Production' }],
    components: {
      securitySchemes: {
        apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
        adminSecret: { type: 'apiKey', in: 'header', name: 'x-admin-secret' },
      },
    },
  },
});

await fastify.register(swaggerUi, {
  routePrefix: '/docs',
  uiConfig: { docExpansion: 'list', deepLinking: true },
  theme: {
    title: 'SchedKit API Docs',
    css: [{ filename: 'docs.css', content: `
      body { background: #0a0a0b !important; }
      .swagger-ui { background: #0a0a0b; color: #e8e8ea; }
      .swagger-ui .topbar { background: #111114; border-bottom: 1px solid #1e1e24; }
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

// Page routes (no prefix)
fastify.get('/login', async (req, reply) => {
  const { readFileSync } = await import('fs');
  return reply.type('text/html').send(readFileSync(join(__dirname, '../public/login.html')));
});
fastify.get('/google-callback', async (req, reply) => {
  const { readFileSync } = await import('fs');
  return reply.type('text/html').send(readFileSync(join(__dirname, '../public/google-callback.html')));
});
fastify.get('/dashboard', async (req, reply) => {
  const { readFileSync } = await import('fs');
  return reply.type('text/html').send(readFileSync(join(__dirname, '../public/dashboard.html')));
});

fastify.get('/onboarding', async (req, reply) => {
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
