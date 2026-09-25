/**
 * Cloudflare Email Worker — support@ → SchedKit inbound ticket
 *
 * Setup:
 * 1. wrangler secret put PORTAL_INBOUND_SECRET
 * 2. Set SCHEDKIT_URL in wrangler.toml [vars] (default https://schedkit.net)
 * 3. Cloudflare Dashboard → Email Routing → support@projectseven.us → Send to Worker
 *
 * @see https://developers.cloudflare.com/email-routing/email-workers/send-email-to-worker/
 */

const MAX_BODY = 12000;

function extractEmail(raw) {
  const m = String(raw || '').match(/<([^>]+)>/) || String(raw || '').match(/([\w.+-]+@[\w.-]+\.\w+)/);
  return (m?.[1] || raw || '').trim().toLowerCase();
}

function extractName(raw, email) {
  const s = String(raw || '').trim();
  if (!s) return email.split('@')[0];
  return s.replace(/<[^>]+>/, '').trim() || email.split('@')[0];
}

async function readText(message) {
  if (message.text) return message.text.slice(0, MAX_BODY);
  if (!message.raw) return '';
  const raw = await new Response(message.raw).text();
  // Plain-text part or stripped tags — good enough for v1
  const plain = raw.match(/Content-Type: text\/plain[\s\S]*?\n\n([\s\S]*?)(?:\n--|$)/i);
  if (plain?.[1]) return plain[1].trim().slice(0, MAX_BODY);
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_BODY);
}

export default {
  async email(message, env, ctx) {
    const secret = env.PORTAL_INBOUND_SECRET;
    const baseUrl = (env.SCHEDKIT_URL || 'https://schedkit.net').replace(/\/$/, '');

    if (!secret) {
      console.error('PORTAL_INBOUND_SECRET not set');
      return;
    }

    const fromRaw = message.from;
    const email = extractEmail(fromRaw);
    const name = extractName(fromRaw, email);
    const subject = message.headers.get('subject') || '(no subject)';
    const messageId = message.headers.get('message-id') || `cf-${Date.now()}`;
    const body = await readText(message);

    if (!email || !body) {
      console.warn('Skipping email — missing from or body', { email, subject });
      return;
    }

    // Optional: ignore auto-replies / mailer-daemon
    const autoSubmitted = message.headers.get('auto-submitted');
    if (autoSubmitted && autoSubmitted !== 'no') return;

    const payload = {
      org_slug: env.PORTAL_ORG_SLUG || 'projectseven',
      name,
      email,
      subject: subject.replace(/^\[P7-\d+\]\s*/i, '').trim() || subject,
      message: body,
      source: 'email',
      source_ref: messageId,
      department_slug: env.INBOUND_DEPARTMENT_SLUG || 'technical',
      priority: 'normal',
    };

    const res = await fetch(`${baseUrl}/v1/portal/inbound/ticket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Portal-Inbound-Secret': secret,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('SchedKit inbound failed', res.status, err);
      message.setReject('Ticket creation failed');
    }
  },
};
