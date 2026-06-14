const ADMIN_EMAILS = (process.env.PLATFORM_ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

export function isPlatformAdmin(email) {
  if (!email || !ADMIN_EMAILS.length) return false;
  return ADMIN_EMAILS.includes(String(email).trim().toLowerCase());
}
