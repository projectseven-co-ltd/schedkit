#!/usr/bin/env node
/** Manual re-run of portal bootstrap (normally automatic on API startup). */
import 'dotenv/config';
import { initDb } from '../src/lib/db.mjs';

await initDb();
console.log('Done — portal bootstrap runs inside initDb on startup');
process.exit(0);
