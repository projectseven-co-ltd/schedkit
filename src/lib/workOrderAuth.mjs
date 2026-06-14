// Work order access: owner, assignee, org dispatchers (admin / can_manage_work_orders)

import { db } from './noco.mjs';
import { tables } from './tables.mjs';
import { userOwnsRow } from './ownership.mjs';

const MANAGER_ROLES = new Set(['admin', 'owner']);

let membershipCache = new Map();

async function getMemberships(userId) {
  const key = String(userId);
  if (membershipCache.has(key)) return membershipCache.get(key);
  const r = await db.find(tables.org_members, `(user_id,eq,${userId})`, { limit: 200 });
  const list = r.list || [];
  membershipCache.set(key, list);
  setTimeout(() => membershipCache.delete(key), 30000);
  return list;
}

export async function canManageWorkOrdersInOrg(userId, orgId) {
  if (!orgId) return false;
  const org = await db.get(tables.organizations, orgId);
  if (org && String(org.owner_user_id) === String(userId)) return true;
  const memberships = await getMemberships(userId);
  const m = memberships.find(x => String(x.org_id) === String(orgId));
  if (!m) return false;
  if (MANAGER_ROLES.has(m.role)) return true;
  return !!m.can_manage_work_orders;
}

export async function canAccessWorkOrder(user, wo) {
  if (!wo || !user?.Id) return false;
  if (userOwnsRow(wo, user)) return true;
  if (wo.assignee_id && String(wo.assignee_id) === String(user.Id)) return true;
  if (wo.org_id && await canManageWorkOrdersInOrg(user.Id, wo.org_id)) return true;
  return false;
}

export async function canManageWorkOrder(user, wo) {
  if (!wo || !user?.Id) return false;
  if (userOwnsRow(wo, user)) return true;
  if (wo.org_id && await canManageWorkOrdersInOrg(user.Id, wo.org_id)) return true;
  return false;
}

export async function getAccessibleWorkOrder(id, user) {
  const wo = await db.get(tables.work_orders, id);
  if (!wo || !(await canAccessWorkOrder(user, wo))) return null;
  return wo;
}

export async function listWorkOrdersForUser(user, { status, priority, limit = 50, page = 1 } = {}) {
  const userId = String(user.Id);
  const seen = new Map();

  async function addRows(where) {
    const result = await db.list(tables.work_orders, {
      where,
      limit: 200,
      sort: '-updated_at',
    });
    for (const wo of result.list || []) {
      seen.set(String(wo.Id ?? wo.id), wo);
    }
  }

  await addRows(`(user_id,eq,${userId})`);
  await addRows(`(assignee_id,eq,${userId})`);

  const memberships = await getMemberships(userId);
  for (const m of memberships) {
    const canManage = MANAGER_ROLES.has(m.role) || m.can_manage_work_orders;
    if (canManage && m.org_id) {
      await addRows(`(org_id,eq,${m.org_id})`);
    }
  }

  const ownedOrgs = await db.find(tables.organizations, `(owner_user_id,eq,${userId})`, { limit: 50 });
  for (const org of ownedOrgs.list || []) {
    await addRows(`(org_id,eq,${org.Id ?? org.id})`);
  }

  let list = [...seen.values()];
  if (status) list = list.filter(wo => wo.status === status);
  if (priority) list = list.filter(wo => wo.priority === priority);
  list.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));

  const total = list.length;
  const offset = (page - 1) * limit;
  list = list.slice(offset, offset + limit);
  return { list, total };
}

export async function resolveAssigneeName(assigneeId) {
  if (!assigneeId) return null;
  try {
    const u = await db.get(tables.users, assigneeId);
    return u?.name || u?.email || null;
  } catch {
    return null;
  }
}
