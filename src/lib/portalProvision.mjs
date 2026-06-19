import { db } from './noco.mjs';
import { tables } from './tables.mjs';
import { nanoid } from 'nanoid';

function slugify(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client';
}

async function getPortalOrg(orgSlug) {
  const orgs = await db.find(tables.organizations, `(slug,eq,${orgSlug})`);
  return orgs.list?.[0] || null;
}

export async function ensureSchedkitUser({ email, name, passwordHash }) {
  const normalized = String(email || '').toLowerCase().trim();
  if (!normalized) return null;

  let userResult = await db.find(tables.users, `(email,eq,${normalized})`);
  let user = userResult.list?.[0];

  if (!user) {
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
  } else if (passwordHash && !user.password_hash) {
    user = await db.update(tables.users, user.Id, { password_hash: passwordHash });
  }

  return user;
}

export async function upsertPortalFromBlestaClient(blestaClient, { orgSlug = 'projectseven' } = {}) {
  const org = await getPortalOrg(orgSlug);
  if (!org) throw new Error(`Portal org not found: ${orgSlug}`);

  const blestaId = Number(blestaClient.id);
  const company = blestaClient.company
    || [blestaClient.first_name, blestaClient.last_name].filter(Boolean).join(' ')
    || `Client ${blestaId}`;

  let client = (await db.find(tables.clients, `(blesta_client_id,eq,${blestaId})`)).list?.[0];
  if (!client) {
    client = await db.create(tables.clients, {
      org_id: String(org.Id),
      company_name: company,
      slug: slugify(company),
      blesta_client_id: blestaId,
      status: blestaClient.status === 'inactive' ? 'inactive' : 'active',
      created_at: new Date().toISOString(),
    });
  }

  let contacts = [];
  try {
    const { blestaApi } = await import('./blestaApi.mjs');
    contacts = await blestaApi('contacts', 'getAll', { client_id: blestaId });
  } catch {
    contacts = [];
  }
  if (!Array.isArray(contacts)) contacts = contacts ? [contacts] : [];

  if (!contacts.length) {
    contacts = [{
      email: blestaClient.email,
      first_name: blestaClient.first_name,
      last_name: blestaClient.last_name,
      primary: true,
      id: blestaClient.contact_id,
    }];
  }

  let primaryContact = null;
  let primaryUser = null;

  for (const c of contacts) {
    const email = String(c.email || '').toLowerCase().trim();
    if (!email) continue;

    const contactName = [c.first_name, c.last_name].filter(Boolean).join(' ') || email.split('@')[0];
    const isPrimary = Boolean(c.primary === '1' || c.primary === 1 || c.primary === true
      || contacts.length === 1);

    let user = null;
    if (isPrimary) {
      user = await ensureSchedkitUser({ email, name: contactName });
      primaryUser = user;
    }

    const existing = await db.find(tables.client_contacts,
      `(client_id,eq,${client.Id})~and(email,eq,${email})`);

    if (existing.list?.[0]) {
      const row = existing.list[0];
      if (user && !row.user_id) {
        await db.update(tables.client_contacts, row.Id, { user_id: String(user.Id), name: contactName });
      }
      if (isPrimary) primaryContact = { ...row, email, name: contactName, user_id: user?.Id || row.user_id };
    } else {
      const row = await db.create(tables.client_contacts, {
        client_id: Number(client.Id),
        email,
        name: contactName,
        is_primary: isPrimary,
        blesta_contact_id: c.id ? Number(c.id) : null,
        user_id: user ? String(user.Id) : null,
        created_at: new Date().toISOString(),
      });
      if (isPrimary) primaryContact = row;
    }

    if (isPrimary) {
      const domain = email.split('@')[1]?.toLowerCase();
      if (domain && !domain.includes('gmail.') && !domain.includes('yahoo.') && !domain.includes('hotmail.')) {
        const dom = await db.find(tables.client_domains, `(domain,eq,${domain})`);
        if (!dom.list?.length) {
          await db.create(tables.client_domains, { client_id: Number(client.Id), domain });
        }
      }
    }
  }

  return { org, client, contact: primaryContact, user: primaryUser };
}
