import { db } from './noco.mjs';
import { tables } from './tables.mjs';
import { sendTicketReply } from './mailer.mjs';

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

/**
 * Best email + name for the ticket requester (contact form, portal, inbound).
 */
export async function resolveTicketCustomer(ticket) {
  if (!ticket) return null;

  const directEmail = normalizeEmail(ticket.customer_email);
  if (directEmail) {
    return {
      email: directEmail,
      name: String(ticket.customer_name || '').trim() || directEmail.split('@')[0],
    };
  }

  const clientId = ticket.client_id;
  if (clientId) {
    const contacts = await db.list(tables.client_contacts, {
      where: `(client_id,eq,${clientId})`,
      limit: 20,
    });
    const primary = contacts.list?.find(c => c.is_primary) || contacts.list?.[0];
    const email = normalizeEmail(primary?.email);
    if (email) {
      return {
        email,
        name: String(primary?.name || ticket.customer_name || '').trim() || email.split('@')[0],
      };
    }
  }

  const replies = await db.list(tables.ticket_replies, {
    where: `(ticket_id,eq,${ticket.Id ?? ticket.id})~and(is_staff,eq,false)`,
    sort: 'created_at',
    limit: 1,
  });
  const firstClientReply = replies.list?.[0];
  const replyEmail = normalizeEmail(firstClientReply?.author_email);
  if (replyEmail) {
    return {
      email: replyEmail,
      name: String(firstClientReply.author_name || ticket.customer_name || '').trim()
        || replyEmail.split('@')[0],
    };
  }

  return null;
}

export async function notifyCustomerOfStaffReply(ticket, replyRow) {
  if (!ticket || !replyRow?.is_staff) return;

  const customer = await resolveTicketCustomer(ticket);
  if (!customer?.email) return;

  const staffEmail = normalizeEmail(replyRow.author_email);
  if (staffEmail && staffEmail === customer.email) return;

  const statusUrl = ticket.customer_token
    ? `${process.env.BASE_URL || 'https://schedkit.net'}/incidents/status/${ticket.customer_token}`
    : null;

  const org = ticket.org_id ? await db.get(tables.organizations, ticket.org_id) : null;

  await sendTicketReply({
    to_email: customer.email,
    to_name: customer.name,
    ticket_id: ticket.Id ?? ticket.id,
    title: ticket.title,
    reply_body: replyRow.body,
    author_name: replyRow.author_name || 'Support',
    status_url: statusUrl,
    org,
    public_code: ticket.public_code,
  }).catch(() => {});
}
