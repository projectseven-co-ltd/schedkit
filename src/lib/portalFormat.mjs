// Blesta-shaped responses for the Project Seven React portal.

const PRIORITY_TO_PORTAL = {
  low: 'low',
  normal: 'medium',
  high: 'high',
  urgent: 'critical',
};

const PRIORITY_FROM_PORTAL = {
  low: 'low',
  medium: 'normal',
  high: 'high',
  critical: 'urgent',
};

const STATUS_TO_PORTAL = {
  open: 'open',
  in_progress: 'in_progress',
  resolved: 'closed',
  closed: 'closed',
};

export function portalPriorityFromSchedkit(priority) {
  return PRIORITY_TO_PORTAL[priority] || priority || 'medium';
}

export function schedkitPriorityFromPortal(priority) {
  return PRIORITY_FROM_PORTAL[String(priority || '').toLowerCase()] || 'normal';
}

export function portalStatusFromSchedkit(status) {
  return STATUS_TO_PORTAL[status] || status || 'open';
}

export function formatPortalTicketRow(ticket, departmentName = '') {
  const updated = ticket.updated_at || ticket.created_at || ticket.CreatedAt;
  return {
    id: ticket.Id ?? ticket.id,
    code: ticket.public_code || `P7-${ticket.Id ?? ticket.id}`,
    summary: ticket.title || '',
    status: portalStatusFromSchedkit(ticket.status),
    priority: portalPriorityFromSchedkit(ticket.priority),
    department: departmentName || '',
    date_added: ticket.created_at || ticket.CreatedAt || '',
    date_updated: updated || '',
  };
}

export function formatPortalReply(reply) {
  return {
    id: reply.Id ?? reply.id,
    type: 'reply',
    details: reply.body || '',
    date_added: reply.created_at || reply.CreatedAt || '',
    author: reply.author_name || (reply.is_staff ? 'Support Staff' : 'Client'),
    author_type: reply.is_staff ? 'staff' : 'client',
  };
}

export function formatPortalTicketDetail(ticket, replies = [], departmentName = '') {
  const row = formatPortalTicketRow(ticket, departmentName);
  return {
    ...row,
    number: row.code,
    replies: replies.map(formatPortalReply),
  };
}

export async function assignPublicCode(db, tables, ticketId) {
  const code = `P7-${String(ticketId).padStart(4, '0')}`;
  await db.update(tables.tickets, ticketId, {
    public_code: code,
    updated_at: new Date().toISOString(),
  });
  return code;
}
