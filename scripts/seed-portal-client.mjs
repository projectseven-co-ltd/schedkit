#!/usr/bin/env node
/**
 * Seed a portal client + contact linked to a SchedKit user.
 *
 * Usage:
 *   node scripts/seed-portal-client.mjs \
 *     --org-slug projectseven \
 *     --email client@example.com \
 *     --name "Acme Corp" \
 *     --company "Acme Corporation" \
 *     --password 'secret123'
 */
import 'dotenv/config';
import { initDb, db } from '../src/lib/db.mjs';
import { tables } from '../src/lib/tables.mjs';
import { hashPassword } from '../src/lib/password.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  await initDb();

  const orgSlug = arg('org-slug') || 'projectseven';
  const email = String(arg('email') || '').toLowerCase().trim();
  const name = arg('name') || email.split('@')[0];
  const company = arg('company') || name;
  const password = arg('password');
  const blestaId = arg('blesta-client-id');

  if (!email) {
    console.error('Missing --email');
    process.exit(1);
  }

  const orgs = await db.find(tables.organizations, `(slug,eq,${orgSlug})`);
  const org = orgs.list?.[0];
  if (!org) {
    console.error(`Org not found: ${orgSlug}`);
    process.exit(1);
  }

  let userResult = await db.find(tables.users, `(email,eq,${email})`);
  let user = userResult.list?.[0];
  if (!user) {
    const { nanoid } = await import('nanoid');
    user = await db.create(tables.users, {
      email,
      name,
      slug: email.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase(),
      api_key: `p7s_${nanoid(32)}`,
      plan: 'enterprise',
      active: true,
      created_at: new Date().toISOString(),
    });
    console.log('Created user', user.Id);
  }

  if (password) {
    const password_hash = await hashPassword(password);
    await db.update(tables.users, user.Id, { password_hash });
    console.log('Set password for user', user.Id);
  }

  const existingClients = await db.find(tables.clients,
    `(org_id,eq,${org.Id})~and(company_name,eq,${company})`);
  let client = existingClients.list?.[0];
  if (!client) {
    client = await db.create(tables.clients, {
      org_id: String(org.Id),
      company_name: company,
      slug: company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      blesta_client_id: blestaId ? Number(blestaId) : null,
      status: 'active',
      created_at: new Date().toISOString(),
    });
    console.log('Created client', client.Id);
  }

  const domain = email.split('@')[1];
  if (domain) {
    const domains = await db.find(tables.client_domains, `(domain,eq,${domain})`);
    if (!domains.list?.length) {
      await db.create(tables.client_domains, { client_id: Number(client.Id), domain });
      console.log('Added domain', domain);
    }
  }

  const contacts = await db.find(tables.client_contacts,
    `(client_id,eq,${client.Id})~and(email,eq,${email})`);
  if (!contacts.list?.length) {
    await db.create(tables.client_contacts, {
      client_id: Number(client.Id),
      email,
      name,
      is_primary: true,
      user_id: String(user.Id),
      created_at: new Date().toISOString(),
    });
    console.log('Created contact for', email);
  } else {
    await db.update(tables.client_contacts, contacts.list[0].Id, {
      user_id: String(user.Id),
      name,
    });
    console.log('Updated contact for', email);
  }

  console.log('\nDone.');
  console.log(`  org:    ${orgSlug} (${org.Id})`);
  console.log(`  client: ${client.Id} — ${company}`);
  console.log(`  user:   ${user.Id} — ${email}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
