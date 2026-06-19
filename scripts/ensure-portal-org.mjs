#!/usr/bin/env node
/**
 * Ensure the Project Seven portal org exists in SchedKit.
 *
 * Usage:
 *   node scripts/ensure-portal-org.mjs --slug projectseven --name "Project Seven"
 *   node scripts/ensure-portal-org.mjs --owner-email ceo@projectseven.us
 */
import 'dotenv/config';
import { initDb, db } from '../src/lib/db.mjs';
import { tables } from '../src/lib/tables.mjs';
import { nanoid } from 'nanoid';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  await initDb();

  const slug = arg('slug') || 'projectseven';
  const name = arg('name') || 'Project Seven';
  const ownerEmail = arg('owner-email');

  const existing = await db.find(tables.organizations, `(slug,eq,${slug})`);
  if (existing.list?.[0]) {
    console.log(`Org already exists: ${slug} (id ${existing.list[0].Id})`);
    return;
  }

  let owner = null;
  if (ownerEmail) {
    const users = await db.find(tables.users, `(email,eq,${ownerEmail.toLowerCase()})`);
    owner = users.list?.[0];
  }
  if (!owner) {
    const admins = (process.env.PLATFORM_ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (admins[0]) {
      const users = await db.find(tables.users, `(email,eq,${admins[0].toLowerCase()})`);
      owner = users.list?.[0];
    }
  }
  if (!owner) {
    console.error('No owner user found. Pass --owner-email or set PLATFORM_ADMIN_EMAILS in .env');
    process.exit(1);
  }

  const org = await db.create(tables.organizations, {
    name,
    slug,
    owner_user_id: String(owner.Id),
    api_key: `p7s_org_${nanoid(24)}`,
    created_at: new Date().toISOString(),
  });

  await db.create(tables.org_members, {
    org_id: String(org.Id),
    user_id: String(owner.Id),
    role: 'owner',
    created_at: new Date().toISOString(),
  });

  console.log(`Created org "${name}" (${slug}) id=${org.Id}, owner=${owner.email}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
