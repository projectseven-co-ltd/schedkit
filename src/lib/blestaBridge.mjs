import { blestaApi, blestaConfigured } from './blestaApi.mjs';
import { upsertPortalFromBlestaClient } from './portalProvision.mjs';

const AUTH_BRIDGE_URL = process.env.BLESTA_AUTH_BRIDGE_URL
  || 'https://projectseven.us/portal/api/auth_helper.php';

export function blestaBridgeConfigured() {
  return Boolean(AUTH_BRIDGE_URL && blestaConfigured());
}

/** Validate username/password against Blesta (via projectseven auth_helper). */
export async function validateBlestaLogin(username, password) {
  if (!AUTH_BRIDGE_URL) return null;

  const res = await fetch(AUTH_BRIDGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      username: String(username || '').trim(),
      password: String(password || ''),
    }),
  });

  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  if (!data.valid || !data.user_id) return null;
  return { user_id: Number(data.user_id) };
}

/** After Blesta auth succeeds, provision SchedKit portal records and return identity. */
export async function provisionFromBlestaUser(userId, orgSlug) {
  const client = await blestaApi('clients', 'getByUserId', { user_id: userId });
  if (!client?.id) return null;
  return upsertPortalFromBlestaClient(client, { orgSlug });
}
