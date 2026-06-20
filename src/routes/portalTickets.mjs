import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requirePortalClient } from '../middleware/portalClient.mjs';
import {
  assignPublicCode,
  formatPortalReply,
  formatPortalTicketDetail,
  formatPortalTicketRow,
  schedkitPriorityFromPortal,
} from '../lib/portalFormat.mjs';
import { nanoid } from 'nanoid';
import { sendTicketCreated } from '../lib/mailer.mjs';

const SLA_HOURS = { urgent: 1, high: 4, normal: 24, low: 48 };
const TAG = 'Portal';

function calcSlaDueAt(priority) {
  const hours = SLA_HOURS[priority] ?? 24;
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

async function tryBroadcast(type, payload) {
  try {
    const { broadcastAll } = await import('./incidents.mjs');
    broadcastAll({ type, payload });
  } catch {}
}

async function getDepartmentName(departmentId) {
  if (!departmentId) return '';
  try {
    const dept = await db.get(tables.ticket_departments, departmentId);
    return dept?.name || '';
  } catch {
    return '';
  }
}

async function getOrgOwnerUserId(orgId) {
  const org = await db.get(tables.organizations, orgId);
  return org?.owner_user_id || null;
}

async function loadTicketReplies(ticketId) {
  const result = await db.find(tables.ticket_replies, `(ticket_id,eq,${ticketId})`);
  return (result.list || []).sort((a, b) =>
    new Date(a.created_at || a.CreatedAt) - new Date(b.created_at || b.CreatedAt));
}

async function assertClientOwnsTicket(ticket, clientId) {
  return ticket && String(ticket.client_id) === String(clientId);
}

function portalStatusFilter(status) {
  const s = String(status || 'not_closed').toLowerCase();
  if (s === 'closed') return 'closed';
  return 'not_closed';
}

export default async function portalTicketsRoutes(fastify) {
  // GET /v1/portal/departments
  fastify.get('/departments', {
    preHandler: requirePortalClient,
    schema: { tags: [TAG], summary: 'List ticket departments for portal' },
  }, async (req) => {
    const orgId = String(req.portalClient.org_id);
    const result = await db.find(tables.ticket_departments,
      `(org_id,eq,${orgId})~and(active,eq,true)`, { sort: 'sort_order' });
    const rows = (result.list || []).map(d => ({
      id: d.Id ?? d.id,
      name: d.name,
      description: d.description || '',
    }));
    return rows;
  });

  // GET /v1/portal/tickets
  fastify.get('/tickets', {
    preHandler: requirePortalClient,
    schema: {
      tags: [TAG],
      summary: 'List client tickets',
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          page: { type: 'integer' },
        },
      },
    },
  }, async (req) => {
    const filter = portalStatusFilter(req.query?.status);
    let where = `(client_id,eq,${req.client_id})`;
    if (filter === 'closed') {
      where += '~and(status,eq,closed)';
    } else {
      where += '~and(status,ne,closed)';
    }

    const page = Math.max(1, Number(req.query?.page) || 1);
    const limit = 50;
    const result = await db.list(tables.tickets, {
      where,
      sort: '-updated_at',
      limit,
      offset: (page - 1) * limit,
    });

    const tickets = result.list || [];
    const rows = await Promise.all(tickets.map(async (t) => {
      const deptName = await getDepartmentName(t.department_id);
      return formatPortalTicketRow(t, deptName);
    }));
    return rows;
  });

  // GET /v1/portal/tickets/summary — dashboard slice
  fastify.get('/tickets/summary', {
    preHandler: requirePortalClient,
    schema: { tags: [TAG], summary: 'Recent open tickets for dashboard' },
  }, async (req) => {
    const result = await db.list(tables.tickets, {
      where: `(client_id,eq,${req.client_id})~and(status,ne,closed)`,
      sort: '-updated_at',
      limit: 5,
    });
    const tickets = result.list || [];
    const rows = await Promise.all(tickets.map(async (t) => {
      const deptName = await getDepartmentName(t.department_id);
      return formatPortalTicketRow(t, deptName);
    }));
    const countResult = await db.find(tables.tickets,
      `(client_id,eq,${req.client_id})~and(status,ne,closed)`);
    return {
      tickets: rows,
      tickets_count: countResult.pageInfo?.totalRows || rows.length,
    };
  });

  // GET /v1/portal/tickets/:id
  fastify.get('/tickets/:id', {
    preHandler: requirePortalClient,
    schema: { tags: [TAG], summary: 'Get ticket with replies' },
  }, async (req, reply) => {
    const ticket = await db.get(tables.tickets, req.params.id);
    if (!(await assertClientOwnsTicket(ticket, req.client_id))) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const replies = await loadTicketReplies(ticket.Id);
    const deptName = await getDepartmentName(ticket.department_id);
    return formatPortalTicketDetail(ticket, replies, deptName);
  });

  // POST /v1/portal/tickets
  fastify.post('/tickets', {
    preHandler: requirePortalClient,
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    schema: {
      tags: [TAG],
      summary: 'Open a new support ticket',
      body: {
        type: 'object',
        required: ['subject', 'message'],
        properties: {
          department_id: { type: 'integer' },
          subject: { type: 'string' },
          message: { type: 'string' },
          priority: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const subject = String(req.body?.subject || '').trim();
    const message = String(req.body?.message || '').trim();
    const departmentId = req.body?.department_id ?? null;
    const priority = schedkitPriorityFromPortal(req.body?.priority);

    if (!subject || !message) {
      return reply.code(400).send({ error: 'Missing fields' });
    }

    const orgId = String(req.portalClient.org_id);
    const ownerUserId = await getOrgOwnerUserId(orgId);
    const customer_token = nanoid(24);
    const now = new Date().toISOString();

    const ticket = await db.create(tables.tickets, {
      title: subject,
      description: message,
      status: 'open',
      priority,
      user_id: ownerUserId ? String(ownerUserId) : String(req.user.Id),
      client_id: String(req.client_id),
      org_id: orgId,
      department_id: departmentId ? String(departmentId) : null,
      source: 'portal',
      sla_due_at: calcSlaDueAt(priority),
      sla_breached: false,
      customer_token,
      customer_email: req.portalContact.email || req.user.email,
      customer_name: req.portalContact.name || req.user.name || '',
      created_at: now,
      updated_at: now,
    });

    const public_code = await assignPublicCode(db, tables, ticket.Id);

    await db.create(tables.ticket_replies, {
      ticket_id: Number(ticket.Id),
      user_id: String(req.user.Id),
      author_name: req.portalContact.name || req.user.name || 'Client',
      author_email: req.portalContact.email || req.user.email,
      body: message,
      is_staff: false,
      created_at: now,
    });

    const deptName = await getDepartmentName(departmentId);
    const result = {
      ...ticket,
      public_code,
      customer_status_url: `${process.env.BASE_URL || 'https://schedkit.net'}/incidents/status/${customer_token}`,
    };

    tryBroadcast('incident.created', { ...ticket, public_code, Id: ticket.Id, title: subject, org_id: orgId, client_id: req.client_id });

    const org = orgId ? await db.get(tables.organizations, orgId) : null;
    if (org) {
      sendTicketCreated({
        to_email: req.portalContact.email || req.user.email,
        to_name: req.portalContact.name || req.user.name,
        ticket_id: ticket.Id,
        title: subject,
        priority,
        status_url: result.customer_status_url,
        org,
      }).catch(() => {});
    }

    return reply.code(201).send({ success: true, ticket_id: ticket.Id });
  });

  // POST /v1/portal/tickets/:id/replies
  fastify.post('/tickets/:id/replies', {
    preHandler: requirePortalClient,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: [TAG],
      summary: 'Reply to a ticket',
      body: {
        type: 'object',
        required: ['message'],
        properties: { message: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const ticket = await db.get(tables.tickets, req.params.id);
    if (!(await assertClientOwnsTicket(ticket, req.client_id))) {
      return reply.code(404).send({ error: 'Not found' });
    }
    if (ticket.status === 'closed') {
      return reply.code(400).send({ error: 'Ticket is closed' });
    }

    const message = String(req.body?.message || req.body?.body || '').trim();
    if (!message) return reply.code(400).send({ error: 'Missing message' });

    const now = new Date().toISOString();
    const replyRow = await db.create(tables.ticket_replies, {
      ticket_id: Number(ticket.Id),
      user_id: String(req.user.Id),
      author_name: req.portalContact.name || req.user.name || 'Client',
      author_email: req.portalContact.email || req.user.email,
      body: message,
      is_staff: false,
      created_at: now,
    });

    await db.update(tables.tickets, ticket.Id, {
      status: ticket.status === 'resolved' ? 'open' : ticket.status,
      updated_at: now,
    });

    tryBroadcast('reply.added', {
      ticket_id: ticket.Id,
      reply: replyRow,
      customer_token: ticket.customer_token,
    });

    return { success: true, reply: formatPortalReply(replyRow) };
  });

  // PATCH /v1/portal/tickets/:id — close ticket
  fastify.patch('/tickets/:id', {
    preHandler: requirePortalClient,
    schema: {
      tags: [TAG],
      summary: 'Update ticket (close)',
      body: {
        type: 'object',
        properties: { status: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const ticket = await db.get(tables.tickets, req.params.id);
    if (!(await assertClientOwnsTicket(ticket, req.client_id))) {
      return reply.code(404).send({ error: 'Not found' });
    }

    const status = String(req.body?.status || '').toLowerCase();
    if (status !== 'closed') {
      return reply.code(400).send({ error: 'Only closing tickets is supported' });
    }

    const now = new Date().toISOString();
    await db.update(tables.tickets, ticket.Id, { status: 'closed', updated_at: now });

    tryBroadcast('incident.updated', {
      ...ticket,
      status: 'closed',
      customer_token: ticket.customer_token,
    });

    return { success: true };
  });
}
