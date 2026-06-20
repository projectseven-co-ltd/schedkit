import { db } from './noco.mjs';
import { tables } from './tables.mjs';
import { findContactByEmail } from '../middleware/portalClient.mjs';
import { assignPublicCode } from './portalFormat.mjs';
import { calcSlaDueAt, withSlaStatus } from './ticketSla.mjs';
import { sendTicketCreated } from './mailer.mjs';
import { nanoid } from 'nanoid';

async function getOrgBySlug(orgSlug) {
  const result = await db.find(tables.organizations, `(slug,eq,${orgSlug})`);
  return result.list?.[0] || null;
}

async function getOrgOwnerUserId(orgId) {
  const org = await db.get(tables.organizations, orgId);
  return org?.owner_user_id || null;
}

async function getDepartmentBySlug(orgId, slug) {
  if (!slug) return null;
  const result = await db.find(tables.ticket_departments,
    `(org_id,eq,${orgId})~and(slug,eq,${slug})~and(active,eq,true)`);
  return result.list?.[0] || null;
}

async function tryBroadcast(type, payload) {
  try {
    const { broadcastAll } = await import('../routes/incidents.mjs');
    broadcastAll({ type, payload });
  } catch {}
}

async function resolveClientId(email) {
  const contact = await findContactByEmail(email);
  if (!contact?.client_id) return null;
  const client = await db.get(tables.clients, contact.client_id);
  if (!client || client.status === 'inactive') return null;
  return String(client.Id ?? client.id);
}

/**
 * Create a support ticket from a public channel (contact form, inbound email).
 * Links to portal client when sender email matches a contact.
 */
export async function createInboundPortalTicket({
  orgSlug = 'projectseven',
  name,
  email,
  subject,
  message,
  source = 'api',
  sourceRef = null,
  departmentSlug = null,
  priority = 'normal',
}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const title = String(subject || '').trim();
  const body = String(message || '').trim();
  const senderName = String(name || '').trim() || normalizedEmail.split('@')[0];

  if (!normalizedEmail || !title || !body) {
    throw Object.assign(new Error('Missing required fields'), { statusCode: 400 });
  }

  const org = await getOrgBySlug(orgSlug);
  if (!org) {
    throw Object.assign(new Error(`Portal org not found: ${orgSlug}`), { statusCode: 503 });
  }

  const orgId = String(org.Id ?? org.id);

  if (sourceRef) {
    const dup = await db.find(tables.tickets,
      `(source,eq,${source})~and(source_ref,eq,${sourceRef})`);
    if (dup.list?.[0]) {
      const existing = dup.list[0];
      return {
        success: true,
        ticket_id: existing.Id ?? existing.id,
        duplicate: true,
        customer_status_url: existing.customer_token
          ? `${process.env.BASE_URL || 'https://schedkit.net'}/incidents/status/${existing.customer_token}`
          : null,
      };
    }
  }

  const clientId = await resolveClientId(normalizedEmail);
  const dept = await getDepartmentBySlug(orgId, departmentSlug);
  const ownerUserId = await getOrgOwnerUserId(orgId);
  const customer_token = nanoid(24);
  const now = new Date().toISOString();

  const ticket = await db.create(tables.tickets, {
    title,
    description: body,
    status: 'open',
    priority,
    user_id: ownerUserId ? String(ownerUserId) : null,
    client_id: clientId,
    org_id: orgId,
    department_id: dept ? String(dept.Id ?? dept.id) : null,
    source,
    source_ref: sourceRef,
    sla_due_at: calcSlaDueAt(priority),
    sla_breached: false,
    customer_token,
    customer_email: normalizedEmail,
    customer_name: senderName,
    created_at: now,
    updated_at: now,
  });

  const public_code = await assignPublicCode(db, tables, ticket.Id);

  await db.create(tables.ticket_replies, {
    ticket_id: Number(ticket.Id),
    user_id: ownerUserId ? String(ownerUserId) : null,
    author_name: senderName,
    author_email: normalizedEmail,
    body,
    is_staff: false,
    created_at: now,
  });

  const statusUrl = `${process.env.BASE_URL || 'https://schedkit.net'}/incidents/status/${customer_token}`;

  tryBroadcast('incident.created', withSlaStatus(ticket));

  sendTicketCreated({
    to_email: normalizedEmail,
    to_name: senderName,
    ticket_id: ticket.Id,
    title,
    priority,
    status_url: statusUrl,
    org,
  }).catch(() => {});

  return {
    success: true,
    ticket_id: ticket.Id,
    public_code,
    customer_status_url: statusUrl,
  };
}
