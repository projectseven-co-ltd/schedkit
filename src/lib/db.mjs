import { db as nocoDb, meta as nocoMeta } from './nocoClient.mjs';
import { db as pgDb, runMigrations as pgRunMigrations } from '../db/postgres.mjs';
import { tables, initPostgresTables, loadNocoTableIds } from './tables.mjs';
import { ensureSchema } from './schema.mjs';
import { bootstrapPortal } from './portalBootstrap.mjs';

export const usePostgres = Boolean(process.env.DATABASE_URL);

export const db = usePostgres ? pgDb : nocoDb;

export const meta = usePostgres
  ? {
      getTables: async () => ({ list: [] }),
      createTable: async () => {},
    }
  : nocoMeta;

export async function initDb() {
  if (usePostgres) {
    initPostgresTables();
    await pgRunMigrations();
    await bootstrapPortal();
    console.log('Postgres ready. Tables:', Object.keys(tables).join(', '));
    return;
  }

  await ensureSchema();
  await loadNocoTableIds();
  console.log('NocoDB ready. Tables loaded:', Object.keys(tables).join(', '));
}
