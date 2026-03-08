import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ensureSchema } from './lib/schema.mjs';
import { meta } from './lib/noco.mjs';
import { tables } from './lib/tables.mjs';
import eventTypesRoutes from './routes/eventTypes.mjs';
import availabilityRoutes from './routes/availability.mjs';
import bookingsRoutes from './routes/bookings.mjs';
import usersRoutes from './routes/users.mjs';

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: true });

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

// Health
fastify.get('/health', () => ({ status: 'ok', service: 'p7-scheduler' }));

const port = Number(process.env.PORT || 3000);
await fastify.listen({ port, host: '0.0.0.0' });
console.log(`p7-scheduler running on :${port}`);
