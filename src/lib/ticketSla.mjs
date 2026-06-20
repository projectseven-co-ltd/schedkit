const SLA_HOURS = { urgent: 1, high: 4, normal: 24, low: 48 };

export function calcSlaDueAt(priority) {
  const hours = SLA_HOURS[priority] ?? 24;
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

export function slaStatus(ticket) {
  const { sla_due_at, sla_breached, status, priority } = ticket;
  if (!sla_due_at) return 'ok';
  const resolved = status === 'resolved' || status === 'closed';
  if (resolved) return sla_breached ? 'breached' : 'ok';

  const now = Date.now();
  const due = new Date(sla_due_at).getTime();
  if (sla_breached || now >= due) return 'breached';

  const hours = SLA_HOURS[priority] ?? 24;
  const windowMs = hours * 3600 * 1000;
  const remaining = due - now;
  if (remaining / windowMs <= 0.2) return 'warning';
  return 'ok';
}

export function withSlaStatus(ticket) {
  return { ...normalizeTicketRow(ticket), sla_status: slaStatus(ticket) };
}

/** Normalize id/Id and timestamps for API + SSE consumers. */
export function normalizeTicketRow(ticket) {
  if (!ticket) return ticket;
  const Id = ticket.Id ?? ticket.id;
  const created = ticket.created_at || ticket.CreatedAt;
  return {
    ...ticket,
    Id,
    id: Id,
    CreatedAt: created,
    created_at: created,
    UpdatedAt: ticket.updated_at || ticket.UpdatedAt,
    updated_at: ticket.updated_at || ticket.UpdatedAt,
  };
}
