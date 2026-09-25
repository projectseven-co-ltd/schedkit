const PORTAL_COOKIE_DOMAIN = process.env.PORTAL_COOKIE_DOMAIN || '';
const COOKIE_SECURE = process.env.COOKIE_SECURE !== 'false';
// When PORTAL_COOKIE_DOMAIN is set, cookies are for direct browser→schedkit access.
// When using projectseven.us schedkit.php proxy, leave PORTAL_COOKIE_DOMAIN unset —
// the proxy rewrites Set-Cookie to the portal host.

export function sessionCookie(token, { maxAge = 30 * 86400 } = {}) {
  const domainPart = PORTAL_COOKIE_DOMAIN ? `; Domain=${PORTAL_COOKIE_DOMAIN}` : '';
  const securePart = COOKIE_SECURE ? '; Secure' : '';
  return `sk_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${securePart}${domainPart}`;
}

export function clearSessionCookie() {
  const domainPart = PORTAL_COOKIE_DOMAIN ? `; Domain=${PORTAL_COOKIE_DOMAIN}` : '';
  const securePart = COOKIE_SECURE ? '; Secure' : '';
  return `sk_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${securePart}${domainPart}`;
}
