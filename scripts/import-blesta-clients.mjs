#!/usr/bin/env node
/**
 * Import Blesta clients into SchedKit portal tables.
 *
 * Requires Blesta REST API credentials in env:
 *   BLESTA_URL          (default https://projectseven.us/core/api/)
 *   BLESTA_API_USER
 *   BLESTA_API_KEY
 *
 * Optional MySQL for password hash import (Blesta users table):
 *   BLESTA_MYSQL_URL    mysql://user:pass@host:3306/dbname
 *
 * Usage:
 *   node scripts/import-blesta-clients.mjs --org-slug projectseven
 *   node scripts/import-blesta-clients.mjs --org-slug projectseven --dry-run
 *   node scripts/import-blesta-clients.mjs --org-slug projectseven --status active
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { initDb, db } from '../src/lib/db.mjs';
import { tables } from '../src/lib/tables.mjs';
import { isBcryptHash } from '../src/lib/password.mjs';

import { blestaApi, blestaConfigured } from '../src/lib/blestaApi.mjs';
const MYSQL_URL = process.env.BLESTA_MYSQL_URL;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

const dryRun = process.argv.includes('--dry-run');
const orgSlug = arg('org-slug') || 'projectseven';
const statusFilter = arg('status') || 'active';

const stats = { clients: 0, contacts: 0, users: 0, domains: 0, skipped: 0, errors: 0 };

async function loadBlestaPasswords() {
  if (!MYSQL_URL) return new Map();
  const conn = await mysql.createConnection(MYSQL_URL);
  try {
    const [rows] = await conn.query(
      'SELECT u.id AS user_id, u.username, u.email, u.password FROM users u WHERE u.password IS NOT NULL AND u.password != \'\''
    );
    const map = new Map();
    for (const row of rows) {
      const email = String(row.email || row.username || '').toLowerCase().trim();
      if (email && isBcryptHash(row.password)) {
        map.set(email, { user_id: row.user_id, password_hash: row.password });
      }
    }
    console.log(`Loaded ${map.size} Blesta password hashes from MySQL`);
    return map;
  } finally {
    await conn.end();
  }
}

function slugify(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client';
}

async function upsertSchedkitUser({ email, name, passwordHash }, dry) {
  const normalized = email.toLowerCase().trim();
  if (!normalized) return null;

  let userResult = await db.find(tables.users, `(email,eq,${normalized})`);
  let user = userResult.list?.[0];

  if (!user && !dry) {
    const { nanoid } = await import('nanoid');
    user = await db.create(tables.users, {
      email: normalized,
      name: name || normalized.split('@')[0],
      slug: slugify(name || normalized.split('@')[0]) + '-' + nanoid(4).toLowerCase(),
      api_key: `p7s_${nanoid(32)}`,
      plan: 'enterprise',
      active: true,
      password_hash: passwordHash || null,
      created_at: new Date().toISOString(),
    });
    stats.users++;
    return user;
  }

  if (user && passwordHash && !dry) {
    const updates = {};
    if (!user.password_hash && passwordHash) updates.password_hash = passwordHash;
    if (name && !user.name) updates.name = name;
    if (Object.keys(updates).length) {
      user = await db.update(tables.users, user.Id, updates);
      if (updates.password_hash) stats.users++;
    }
  }

  return user;
}

async function upsertClientRecord(orgId, blestaClient, dry) {
  const blestaId = Number(blestaClient.id);
  const company = blestaClient.company
    || [blestaClient.first_name, blestaClient.last_name].filter(Boolean).join(' ')
    || `Client ${blestaId}`;

  let client = null;
  const byBlesta = await db.find(tables.clients, `(blesta_client_id,eq,${blestaId})`);
  client = byBlesta.list?.[0];

  if (!client) {
    const payload = {
      org_id: String(orgId),
      company_name: company,
      slug: slugify(company),
      blesta_client_id: blestaId,
      status: blestaClient.status === 'inactive' ? 'inactive' : 'active',
      created_at: new Date().toISOString(),
    };
    if (dry) {
      console.log('[dry-run] would create client', company, `(blesta ${blestaId})`);
      client = { Id: `dry-${blestaId}`, ...payload };
    } else {
      client = await db.create(tables.clients, payload);
      stats.clients++;
    }
  }

  return client;
}

async function upsertContact(clientId, contact, userId, dry) {
  const email = String(contact.email || '').toLowerCase().trim();
  if (!email) return;

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || email.split('@')[0];
  const existing = await db.find(tables.client_contacts,
    `(client_id,eq,${clientId})~and(email,eq,${email})`);

  if (existing.list?.[0]) {
    if (!dry && userId && !existing.list[0].user_id) {
      await db.update(tables.client_contacts, existing.list[0].Id, {
        user_id: String(userId),
        name,
        blesta_contact_id: contact.id ? Number(contact.id) : null,
      });
    }
    return;
  }

  if (dry) {
    console.log('[dry-run] would create contact', email);
    stats.contacts++;
    return;
  }

  await db.create(tables.client_contacts, {
    client_id: Number(clientId),
    email,
    name,
    is_primary: Boolean(contact.primary === '1' || contact.primary === 1 || contact.primary === true),
    blesta_contact_id: contact.id ? Number(contact.id) : null,
    user_id: userId ? String(userId) : null,
    created_at: new Date().toISOString(),
  });
  stats.contacts++;
}

async function upsertDomain(clientId, email, dry) {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain || domain.includes('gmail.') || domain.includes('yahoo.') || domain.includes('hotmail.')) return;

  const existing = await db.find(tables.client_domains, `(domain,eq,${domain})`);
  if (existing.list?.[0]) return;

  if (dry) {
    stats.domains++;
    return;
  }
  await db.create(tables.client_domains, { client_id: Number(clientId), domain });
  stats.domains++;
}

async function importClient(orgId, blestaClient, passwordMap, dry) {
  const clientId = blestaClient.id;
  let full = blestaClient;
  try {
    full = await blestaApi('clients', 'get', { client_id: clientId });
  } catch (e) {
    console.warn(`  skip client ${clientId}: get failed — ${e.message}`);
    stats.skipped++;
    return;
  }

  const skClient = await upsertClientRecord(orgId, full, dry);
  if (!skClient) return;

  let contacts = [];
  try {
    contacts = await blestaApi('contacts', 'getAll', { client_id: clientId });
  } catch {
    contacts = [];
  }
  if (!Array.isArray(contacts)) contacts = contacts ? [contacts] : [];

  if (!contacts.length && full.email) {
    contacts = [{
      email: full.email,
      first_name: full.first_name,
      last_name: full.last_name,
      primary: true,
      id: full.contact_id,
    }];
  }

  for (const contact of contacts) {
    const email = String(contact.email || '').toLowerCase().trim();
    if (!email) continue;

    const pw = passwordMap.get(email);
    let user = null;
    if (pw || contact.primary) {
      user = await upsertSchedkitUser({
        email,
        name: [contact.first_name, contact.last_name].filter(Boolean).join(' '),
        passwordHash: pw?.password_hash || null,
      }, dry);
    }

    await upsertContact(skClient.Id, contact, user?.Id, dry);
    if (contact.primary || contacts.length === 1) {
      await upsertDomain(skClient.Id, email, dry);
    }
  }
}

async function main() {
  await initDb();

  if (!blestaConfigured()) {
    console.error('Set BLESTA_API_USER and BLESTA_API_KEY');
    process.exit(1);
  }

  const orgs = await db.find(tables.organizations, `(slug,eq,${orgSlug})`);
  const org = orgs.list?.[0];
  if (!org) {
    console.error(`Org not found: ${orgSlug}. Create the org in SchedKit first.`);
    process.exit(1);
  }

  console.log(`Importing Blesta clients → SchedKit org "${orgSlug}" (${org.Id})`);
  if (dryRun) console.log('DRY RUN — no writes\n');

  const passwordMap = await loadBlestaPasswords();

  let page = 1;
  while (page <= 100) {
    let batch;
    try {
      batch = await blestaApi('clients', 'getList', { status: statusFilter, page });
    } catch (e) {
      console.error('Blesta getList failed:', e.message);
      process.exit(1);
    }
    const list = Array.isArray(batch) ? batch : (batch ? [batch] : []);
    if (!list.length) break;

    console.log(`Page ${page}: ${list.length} clients`);
    for (const c of list) {
      try {
        await importClient(org.Id, c, passwordMap, dryRun);
      } catch (e) {
        console.error(`  error client ${c.id}:`, e.message);
        stats.errors++;
      }
    }

    if (list.length < 20) break;
    page++;
  }

  console.log('\nImport complete.');
  console.log(`  clients:  ${stats.clients}`);
  console.log(`  contacts: ${stats.contacts}`);
  console.log(`  users:    ${stats.users}`);
  console.log(`  domains:  ${stats.domains}`);
  console.log(`  skipped:  ${stats.skipped}`);
  console.log(`  errors:   ${stats.errors}`);
  if (!MYSQL_URL) {
    console.log('\nTip: set BLESTA_MYSQL_URL to import existing Blesta password hashes.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
