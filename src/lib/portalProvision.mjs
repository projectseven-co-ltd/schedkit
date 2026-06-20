import { db } from './noco.mjs';
import { tables } from './tables.mjs';
import { nanoid } from 'nanoid';

function slugify(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client';
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
