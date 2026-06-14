import { requireSession } from './session.mjs';
import { isPlatformAdmin } from '../lib/platformAdmin.mjs';

export async function requirePlatformAdmin(req, reply) {
  await requireSession(req, reply);
  if (reply.sent) return;
  if (!isPlatformAdmin(req.user?.email)) {
    return reply.code(403).send({ error: 'Platform admin only' });
  }
}
