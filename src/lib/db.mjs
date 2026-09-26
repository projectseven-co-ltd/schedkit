import { db as pgDb, runMigrations as pgRunMigrations } from '../db/postgres.mjs';
import { tables, initPostgresTables } from './tables.mjs';
import { bootstrapPortal } from './portalBootstrap.mjs';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. SchedKit uses Postgres only.');
}

export const db = pgDb;

export async function initDb() {
  initPostgresTables();
  await pgRunMigrations();
  await bootstrapPortal();
  console.log('Postgres ready. Tables:', Object.keys(tables).join(', '));
}
