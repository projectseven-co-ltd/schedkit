import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

export async function findContactByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const result = await db.list(tables.client_contacts, {
    where: `(email,eq,${normalized})`,
    limit: 20,
  });
  const list = result.list || [];
  return list.find(c => c.is_primary) || list[0] || null;
}

export async function findContactByUserId(userId) {
  const result = await db.list(tables.client_contacts, {
    where: `(user_id,eq,${String(userId)})`,
    limit: 20,
  });
  const list = result.list || [];
  return list.find(c => c.is_primary) || list[0] || null;
}

export async function loadClientBundle(clientId) {
  const client = await db.get(tables.clients, clientId);
  if (!client) return null;
  return client;
}

export async function resolvePortalIdentity(user) {
  let contact = await findContactByUserId(user.Id);
  if (!contact && user.email) {
    contact = await findContactByEmail(user.email);
    if (contact && !contact.user_id) {
      await db.update(tables.client_contacts, contact.Id, { user_id: String(user.Id) });
      contact = { ...contact, user_id: String(user.Id) };
    }
  }
  if (!contact) return null;
  const client = await loadClientBundle(contact.client_id);
  if (!client || client.status === 'inactive') return null;
  return { contact, client };
}

export async function requirePortalClient(req, reply) {
  const cookieHeader = req.headers['cookie'] || '';
  const match = cookieHeader.match(/sk_session=([^;]+)/);
  const isApi = req.headers['x-requested-with'] === 'XMLHttpRequest'
    || (req.headers['accept'] || '').includes('application/json')
    || req.url.startsWith('/v1/');

  const unauth = (msg) => isApi
    ? reply.code(401).send({ authenticated: false, error: msg })
    : reply.redirect('/login');

  if (!match) return unauth('Not authenticated');

  const result = await db.find(tables.sessions, `(token,eq,${match[1]})`);
  if (!result.list?.length) return unauth('Session not found');

  const session = result.list[0];
  if (new Date(session.expires_at) < new Date()) return unauth('Session expired');

  const user = await db.get(tables.users, session.user_id);
  if (!user) return unauth('User not found');

  const identity = await resolvePortalIdentity(user);
  if (!identity) {
    return isApi
      ? reply.code(403).send({ authenticated: false, error: 'No portal client linked to this account' })
      : reply.redirect('/login');
  }
  req.user = user;
  req.sessionToken = match[1];
  req.portalContact = identity.contact;
  req.portalClient = identity.client;
  req.client_id = String(identity.client.Id ?? identity.client.id);
}

export async function resolveClientFromEmail(email) {
  const contact = await findContactByEmail(email);
  if (contact) {
    const client = await loadClientBundle(contact.client_id);
    if (client) return { contact, client };
  }

  const domain = normalizeEmail(email).split('@')[1];
  if (!domain) return null;

  const domains = await db.list(tables.client_domains, {
    where: `(domain,eq,${domain})`,
    limit: 1,
  });
  const domainRow = domains.list?.[0];
  if (!domainRow) return null;

  const client = await loadClientBundle(domainRow.client_id);
  if (!client) return null;

  return { contact: null, client, matchedBy: 'domain' };
}
