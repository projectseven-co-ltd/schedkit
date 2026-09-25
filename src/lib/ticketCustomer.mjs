import { db } from './noco.mjs';
import { tables } from './tables.mjs';
import { findContactByUserId } from '../middleware/portalClient.mjs';
import { sendTicketReply, sendTicketStatusChanged } from './mailer.mjs';

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function customerFromEmail(email, name = '') {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return {
    email: normalized,
    name: String(name || '').trim() || normalized.split('@')[0],
  };
}

/**
 * Email + name for the ticket requester — same recipient logic for status and reply alerts.
 */
export async function resolveTicketCustomer(ticket) {
  if (!ticket) return null;

  const direct = customerFromEmail(ticket.customer_email, ticket.customer_name);
  if (direct) return direct;

  const clientId = ticket.client_id;
  if (clientId) {
    const contacts = await db.list(tables.client_contacts, {
      where: `(client_id,eq,${clientId})`,
      limit: 20,
    });
    const primary = contacts.list?.find(c => c.is_primary) || contacts.list?.[0];
    const fromContact = customerFromEmail(primary?.email, primary?.name || ticket.customer_name);
    if (fromContact) return fromContact;
  }

  if (ticket.user_id) {
    const linked = await findContactByUserId(ticket.user_id);
    const fromLinked = customerFromEmail(linked?.email, linked?.name || ticket.customer_name);
    if (fromLinked) return fromLinked;

    const org = ticket.org_id ? await db.get(tables.organizations, ticket.org_id) : null;
    const orgOwnerId = org?.owner_user_id ? String(org.owner_user_id) : null;
    const ticketUserId = String(ticket.user_id);

    // Portal tickets store the client on user_id; inbound tickets store org owner (staff).
    if (!orgOwnerId || ticketUserId !== orgOwnerId) {
      const user = await db.get(tables.users, ticket.user_id);
      const fromUser = customerFromEmail(user?.email, user?.name || ticket.customer_name);
      if (fromUser) return fromUser;
    }
  }

  const replies = await db.list(tables.ticket_replies, {
    where: `(ticket_id,eq,${ticket.Id ?? ticket.id})~and(is_staff,eq,false)`,
    sort: 'created_at',
    limit: 1,
  });
  const firstClientReply = replies.list?.[0];
  const fromReply = customerFromEmail(
    firstClientReply?.author_email,
    firstClientReply?.author_name || ticket.customer_name,
  );
  if (fromReply) return fromReply;

  return null;
}

function ticketStatusUrl(ticket) {
  if (!ticket?.customer_token) return null;
  return `${process.env.BASE_URL || 'https://schedkit.net'}/incidents/status/${ticket.customer_token}`;
}

async function loadTicketOrg(ticket) {
  if (!ticket?.org_id) return null;
  return db.get(tables.organizations, ticket.org_id);
}

export async function notifyCustomerOfStaffReply(ticket, replyRow, isStaff = false) {
  const staffReply = isStaff || replyRow?.is_staff === true || replyRow?.is_staff === 'true';
  if (!ticket || !staffReply) return;

  const customer = await resolveTicketCustomer(ticket);
  if (!customer?.email) return;

  const staffEmail = normalizeEmail(replyRow?.author_email);
  if (staffEmail && staffEmail === customer.email) return;

  const org = await loadTicketOrg(ticket);

  await sendTicketReply({
    to_email: customer.email,
    to_name: customer.name,
    ticket_id: ticket.Id ?? ticket.id,
    title: ticket.title,
    reply_body: replyRow?.body || '',
    author_name: replyRow?.author_name || 'Support',
    status_url: ticketStatusUrl(ticket),
    org,
    public_code: ticket.public_code,
  }).catch((err) => {
    console.error('[ticketCustomer] reply email failed:', err?.message || err);
  });
}

export async function notifyCustomerOfStatusChange(ticket, oldStatus, newStatus) {
  if (!ticket || !newStatus || newStatus === oldStatus) return;

  const customer = await resolveTicketCustomer(ticket);
  if (!customer?.email) return;

  const org = await loadTicketOrg(ticket);

  await sendTicketStatusChanged({
    to_email: customer.email,
    to_name: customer.name,
    ticket_id: ticket.Id ?? ticket.id,
    title: ticket.title,
    old_status: oldStatus,
    new_status: newStatus,
    status_url: ticketStatusUrl(ticket) || `${process.env.BASE_URL || 'https://schedkit.net'}/dashboard`,
    org,
  }).catch((err) => {
    console.error('[ticketCustomer] status email failed:', err?.message || err);
  });
}
