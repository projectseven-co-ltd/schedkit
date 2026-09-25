import { isPlatformAdmin } from './platformAdmin.mjs';

const BUILT_IN_ENTERPRISE_EMAILS = new Set([
  'jrj@p7n.net',
]);

function parseEmailList(value) {
  return String(value || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isEnterpriseEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  if (BUILT_IN_ENTERPRISE_EMAILS.has(normalized)) return true;
  if (isPlatformAdmin(normalized)) return true;
  return parseEmailList(process.env.ENTERPRISE_EMAILS).includes(normalized);
}

export function applyUserEntitlements(user) {
  if (!user) return user;
  if (!isEnterpriseEmail(user.email)) {
    return {
      ...user,
      enterprise: user.enterprise || user.plan === 'enterprise',
    };
  }
  return {
    ...user,
    plan: 'enterprise',
    enterprise: true,
  };
}
