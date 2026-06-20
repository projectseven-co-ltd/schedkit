import { db } from './noco.mjs';
import { tables } from './tables.mjs';
import { withSlaStatus } from './ticketSla.mjs';

export async function getUserOrgIds(userId) {
  const ids = new Set();
  const uid = String(userId);

  const owned = await db.find(tables.organizations, `(owner_user_id,eq,${uid})`);
  for (const o of owned.list || []) ids.add(String(o.Id ?? o.id));

  const members = await db.find(tables.org_members, `(user_id,eq,${uid})`);
  for (const m of members.list || []) ids.add(String(m.org_id));

  return [...ids];
}

function appendFilters(where, { status, priority } = {}) {
  let w = where;
  if (status) w += `~and(status,eq,${status})`;
  if (priority) w += `~and(priority,eq,${priority})`;
  return w;
}

function ticketKey(t) {
  return String(t.Id ?? t.id);
}

function sortTickets(list) {
  return [...list].sort((a, b) => {
    const ta = new Date(a.updated_at || a.created_at || 0).getTime();
    const tb = new Date(b.updated_at || b.created_at || 0).getTime();
    return tb - ta;
  });
}

/**
 * Tickets visible to staff: assigned to user OR belonging to any org they own/belong to.
 * Portal tickets set org_id + user_id=org owner — org filter is required.
 */
export async function listStaffTickets(userId, { status, priority, limit = 50, page = 1 } = {}) {
  const uid = String(userId);
  const orgIds = await getUserOrgIds(userId);
  const merged = new Map();

  const userResult = await db.list(tables.tickets, {
    where: appendFilters(`(user_id,eq,${uid})`, { status, priority }),
    sort: '-created_at',
    limit: 500,
  });
  for (const t of userResult.list || []) merged.set(ticketKey(t), t);

  for (const orgId of orgIds) {
    const orgResult = await db.list(tables.tickets, {
      where: appendFilters(`(org_id,eq,${orgId})`, { status, priority }),
      sort: '-created_at',
      limit: 500,
    });
    for (const t of orgResult.list || []) merged.set(ticketKey(t), t);
  }

  const all = sortTickets(merged.values());
  const offset = (Math.max(1, page) - 1) * limit;
  const pageRows = all.slice(offset, offset + limit).map(withSlaStatus);

  return { tickets: pageRows, total: all.length };
}
