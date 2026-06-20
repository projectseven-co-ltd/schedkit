import { db } from './noco.mjs';
import { tables } from './tables.mjs';
import { nanoid } from 'nanoid';

const DEFAULT_DEPARTMENTS = [
  { name: 'Technical Support', description: 'Hosting, server, and technical issues', slug: 'technical', sort_order: 1 },
  { name: 'Billing', description: 'Invoices, payments, and account billing', slug: 'billing', sort_order: 2 },
  { name: 'Sales', description: 'New services, upgrades, and general inquiries', slug: 'sales', sort_order: 3 },
];

function portalBootstrapEnabled() {
  return Boolean(process.env.PORTAL_ORG_SLUG);
}

async function findOwnerUser() {
  const ownerEmail = (process.env.PORTAL_ORG_OWNER_EMAIL || '').trim().toLowerCase();
  if (ownerEmail) {
    const r = await db.find(tables.users, `(email,eq,${ownerEmail})`);
    if (r.list?.[0]) return r.list[0];
  }

  const admins = (process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  for (const email of admins) {
    const r = await db.find(tables.users, `(email,eq,${email})`);
    if (r.list?.[0]) return r.list[0];
  }

  return null;
}

async function ensureDepartments(orgId) {
  const orgKey = String(orgId);
  for (const dept of DEFAULT_DEPARTMENTS) {
    const existing = await db.find(tables.ticket_departments,
      `(org_id,eq,${orgKey})~and(slug,eq,${dept.slug})`);
    if (existing.list?.[0]) continue;

    await db.create(tables.ticket_departments, {
      org_id: orgKey,
      name: dept.name,
      description: dept.description,
      slug: dept.slug,
      sort_order: dept.sort_order,
      active: true,
      created_at: new Date().toISOString(),
    });
    console.log(`[portal] created department: ${dept.name}`);
  }
}

async function ensurePortalOrg() {
  const slug = process.env.PORTAL_ORG_SLUG || 'projectseven';
  const name = process.env.PORTAL_ORG_NAME || 'Project Seven';

  const existing = await db.find(tables.organizations, `(slug,eq,${slug})`);
  if (existing.list?.[0]) {
    await ensureDepartments(existing.list[0].Id);
    return existing.list[0];
  }

  const owner = await findOwnerUser();
  if (!owner) {
    console.warn(
      `[portal] org "${slug}" not found and no owner user yet — set PLATFORM_ADMIN_EMAILS or PORTAL_ORG_OWNER_EMAIL, then restart (or log into SchedKit once to create your user)`,
    );
    return null;
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

  console.log(`[portal] created org "${name}" (${slug}) id=${org.Id}, owner=${owner.email}`);
  await ensureDepartments(org.Id);
  return org;
}

/** Idempotent portal setup — runs on every API boot after migrations. */
export async function bootstrapPortal() {
  if (!portalBootstrapEnabled()) return null;
  try {
    return await ensurePortalOrg();
  } catch (err) {
    console.error('[portal] bootstrap failed:', err.message);
    return null;
  }
}
