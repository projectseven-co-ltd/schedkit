// src/routes/workOrders.mjs — Work Orders API (field job documentation)

import { createHash } from 'crypto';
import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { userOwnsRow } from '../lib/ownership.mjs';
import {
  canAccessWorkOrder,
  canManageWorkOrder,
  canManageWorkOrdersInOrg,
  getAccessibleWorkOrder,
  listWorkOrdersForUser,
  resolveAssigneeName,
} from '../lib/workOrderAuth.mjs';
import { requireApiKey } from '../middleware/auth.mjs';
import { requireSession } from '../middleware/session.mjs';
import { nanoid } from 'nanoid';
import { generateWorkOrderPdf } from '../lib/workOrderPdf.mjs';

async function requireAuth(req, reply) {
  if (req.headers['x-api-key']) return requireApiKey(req, reply);
  return requireSession(req, reply);
}

const WO_STATUSES = ['draft', 'scheduled', 'in_progress', 'on_hold', 'completed', 'signed_off', 'closed'];
const TIME_TYPES = ['travel', 'on_site', 'admin', 'other'];
const ATTACHMENT_CATEGORIES = ['before', 'during', 'after', 'inspection', 'other'];
const SIGNATURE_ROLES = ['technician', 'customer'];

function rowId(row) {
  return row?.Id ?? row?.id;
}

function baseUrl() {
  return process.env.PUBLIC_BASE_URL || 'https://schedkit.net';
}

function withUrls(wo) {
  const token = wo.customer_token;
  return {
    ...wo,
    customer_status_url: token ? `${baseUrl()}/work-orders/status/${token}` : null,
    report_url: `${baseUrl()}/v1/work-orders/${rowId(wo)}/report.pdf`,
  };
}

async function getOwnedWorkOrder(id, user) {
  return getAccessibleWorkOrder(id, user);
}

async function enrichWorkOrder(wo, user = null) {
  const id = String(rowId(wo));
  const assignee_name = await resolveAssigneeName(wo.assignee_id);
  const can_manage = user ? await canManageWorkOrder(user, wo) : undefined;
  const [incidents, timeEntries, checklist, lineItems, attachments, signatures] = await Promise.all([
    db.find(tables.work_order_incidents, `(work_order_id,eq,${id})`, { limit: 100 }).catch(() => ({ list: [] })),
    db.find(tables.work_order_time_entries, `(work_order_id,eq,${id})`, { limit: 200, sort: '-started_at' }).catch(() => ({ list: [] })),
    db.find(tables.work_order_checklist_items, `(work_order_id,eq,${id})`, { limit: 200, sort: 'sort_order' }).catch(() => ({ list: [] })),
    db.find(tables.work_order_line_items, `(work_order_id,eq,${id})`, { limit: 200 }).catch(() => ({ list: [] })),
    db.find(tables.work_order_attachments, `(work_order_id,eq,${id})`, { limit: 200, sort: '-created_at' }).catch(() => ({ list: [] })),
    db.find(tables.work_order_signatures, `(work_order_id,eq,${id})`, { limit: 20 }).catch(() => ({ list: [] })),
  ]);

  const activeTimers = (timeEntries.list || []).filter(e => !e.ended_at);
  const checklistDone = (checklist.list || []).filter(i => i.completed).length;
  const partsSubtotal = (lineItems.list || []).reduce((sum, li) => {
    const qty = Number(li.quantity) || 0;
    const cost = Number(li.unit_cost) || 0;
    return sum + qty * cost;
  }, 0);

  return withUrls({
    ...wo,
    assignee_name,
    ...(can_manage !== undefined ? { can_manage } : {}),
    incident_count: (incidents.list || []).length,
    photo_count: (attachments.list || []).length,
    timer_active: activeTimers.length > 0,
    checklist_total: (checklist.list || []).length,
    checklist_done: checklistDone,
    parts_subtotal: partsSubtotal,
    incidents: incidents.list || [],
    time_entries: timeEntries.list || [],
    checklist: checklist.list || [],
    line_items: lineItems.list || [],
    attachments: mapAttachments(attachments.list),
    signatures: signatures.list || [],
  });
}

function calcDurationMinutes(start, end) {
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000));
}

function parseAnnotations(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function mapAttachments(list) {
  return (list || []).map(a => ({
    ...a,
    annotations: parseAnnotations(a.annotations),
  }));
}

export default async function workOrdersRoutes(fastify) {
  // GET /work-orders
  fastify.get('/work-orders', {
    preHandler: requireAuth,
    schema: {
      tags: ['Work Orders'],
      summary: 'List work orders',
      security: [{ apiKey: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          priority: { type: 'string' },
          search: { type: 'string' },
          assignee: { type: 'string', enum: ['me', 'unassigned', 'all'], description: 'Filter by assignment' },
          limit: { type: 'integer', default: 50 },
          page: { type: 'integer', default: 1 },
        },
      },
    },
  }, async (req) => {
    const { status, priority, limit = 50, page = 1, assignee = 'all' } = req.query;
    const { list, total } = await listWorkOrdersForUser(req.user, { status, priority, limit: 200, page: 1 });

    let filtered = list;
    if (assignee === 'me') {
      filtered = list.filter(wo => String(wo.assignee_id) === String(req.user.Id));
    } else if (assignee === 'unassigned') {
      filtered = list.filter(wo => !wo.assignee_id);
    }

    if (req.query.search) {
      const q = String(req.query.search).toLowerCase();
      filtered = filtered.filter(wo =>
        (wo.title || '').toLowerCase().includes(q) ||
        (wo.site_address || '').toLowerCase().includes(q) ||
        (wo.customer_name || '').toLowerCase().includes(q));
    }

    const totalFiltered = filtered.length;
    const offset = (page - 1) * limit;
    const pageList = filtered.slice(offset, offset + limit);

    const work_orders = await Promise.all(pageList.map(async (wo) => {
      const id = String(rowId(wo));
      const assignee_name = await resolveAssigneeName(wo.assignee_id);
      const [incidents, attachments, timeEntries] = await Promise.all([
        db.find(tables.work_order_incidents, `(work_order_id,eq,${id})`, { limit: 1 }).catch(() => ({ list: [] })),
        db.find(tables.work_order_attachments, `(work_order_id,eq,${id})`, { limit: 1 }).catch(() => ({ list: [] })),
        db.find(tables.work_order_time_entries, `(work_order_id,eq,${id})~and(ended_at,eq,)`, { limit: 1 }).catch(() => ({ list: [] })),
      ]);
      return withUrls({
        ...wo,
        assignee_name,
        incident_count: incidents.pageInfo?.totalRows ?? (incidents.list || []).length,
        photo_count: attachments.pageInfo?.totalRows ?? (attachments.list || []).length,
        timer_active: (timeEntries.list || []).length > 0,
      });
    }));

    return { work_orders, total: totalFiltered };
  });

  // GET /work-orders/assignees — org members eligible for assignment
  fastify.get('/work-orders/assignees', {
    preHandler: requireAuth,
    schema: {
      tags: ['Work Orders'],
      summary: 'List assignable users for an org',
      security: [{ apiKey: [] }],
      querystring: {
        type: 'object',
        properties: {
          org_id: { type: 'string' },
          work_order_id: { type: 'string', description: 'Authorizes via can_manage on this work order' },
        },
      },
    },
  }, async (req, reply) => {
    let { org_id: orgId, work_order_id: woId } = req.query;
    if (woId) {
      const wo = await getAccessibleWorkOrder(woId, req.user);
      if (!wo || !(await canManageWorkOrder(req.user, wo))) {
        return reply.code(403).send({ error: 'Not authorized to assign this work order' });
      }
      orgId = wo.org_id || orgId;
    } else if (orgId && !(await canManageWorkOrdersInOrg(req.user.Id, orgId))) {
      return reply.code(403).send({ error: 'Not authorized to assign in this org' });
    }
    if (!orgId) {
      return {
        assignees: [{
          id: String(req.user.Id),
          name: req.user.name || req.user.email,
          email: req.user.email,
        }],
      };
    }
    const membersResult = await db.find(tables.org_members, `(org_id,eq,${orgId})`, { limit: 200 });
    const assignees = await Promise.all(
      (membersResult.list || []).map(async (m) => {
        const user = await db.get(tables.users, m.user_id);
        if (!user) return null;
        return {
          id: String(user.Id ?? user.id),
          name: user.name || user.email,
          email: user.email,
        };
      })
    );
    return { assignees: assignees.filter(Boolean) };
  });

  // POST /work-orders
  fastify.post('/work-orders', {
    preHandler: requireAuth,
    schema: {
      tags: ['Work Orders'],
      summary: 'Create work order',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          site_address: { type: 'string' },
          site_notes: { type: 'string' },
          status: { type: 'string', enum: WO_STATUSES },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
          scheduled_start: { type: 'string' },
          scheduled_end: { type: 'string' },
          booking_id: { type: 'string' },
          customer_name: { type: 'string' },
          customer_email: { type: 'string' },
          org_id: { type: 'string' },
          assignee_id: { type: 'string', nullable: true },
          lat: { type: 'number' },
          lng: { type: 'number' },
          location_name: { type: 'string' },
          checklist: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                required: { type: 'boolean' },
                sort_order: { type: 'integer' },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const {
      title, description, site_address, site_notes, status = 'draft', priority = 'normal',
      scheduled_start, scheduled_end, booking_id, customer_name, customer_email, org_id,
      assignee_id, lat, lng, location_name, checklist = [],
    } = req.body;

    const uid = `wo_${nanoid(12)}`;
    const customer_token = nanoid(24);
    const now = new Date().toISOString();

    const wo = await db.create(tables.work_orders, {
      uid,
      user_id: req.user.Id,
      org_id: org_id || null,
      title,
      description: description || '',
      site_address: site_address || '',
      site_notes: site_notes || '',
      status,
      priority,
      scheduled_start: scheduled_start || null,
      scheduled_end: scheduled_end || null,
      booking_id: booking_id || null,
      customer_name: customer_name || null,
      customer_email: customer_email || null,
      customer_token,
      assignee_id: assignee_id || null,
      lat: lat ?? null,
      lng: lng ?? null,
      location_name: location_name ?? null,
      created_at: now,
      updated_at: now,
    });

    const woId = String(rowId(wo));
    for (let i = 0; i < checklist.length; i++) {
      const item = checklist[i];
      if (!item?.label) continue;
      await db.create(tables.work_order_checklist_items, {
        work_order_id: woId,
        label: item.label,
        sort_order: item.sort_order ?? i,
        required: !!item.required,
      });
    }

    return reply.code(201).send(await enrichWorkOrder(wo, req.user));
  });

  // GET /work-orders/:id
  fastify.get('/work-orders/:id', {
    preHandler: requireAuth,
    schema: { tags: ['Work Orders'], summary: 'Get work order detail', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    return enrichWorkOrder(wo, req.user);
  });

  // PATCH /work-orders/:id
  fastify.patch('/work-orders/:id', {
    preHandler: requireAuth,
    schema: {
      tags: ['Work Orders'],
      summary: 'Update work order',
      security: [{ apiKey: [] }],
      body: { type: 'object', additionalProperties: true },
    },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });

    const allowed = [
      'title', 'description', 'site_address', 'site_notes', 'status', 'priority',
      'scheduled_start', 'scheduled_end', 'customer_name', 'customer_email',
      'lat', 'lng', 'location_name', 'org_id',
    ];
    const patch = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    if (req.body.assignee_id !== undefined) {
      if (!(await canManageWorkOrder(req.user, wo))) {
        return reply.code(403).send({ error: 'Only dispatchers can change assignee' });
      }
      patch.assignee_id = req.body.assignee_id || null;
    }
    if (patch.status && !WO_STATUSES.includes(patch.status)) {
      return reply.code(400).send({ error: 'Invalid status' });
    }

    const updated = await db.update(tables.work_orders, rowId(wo), patch);
    return enrichWorkOrder(updated, req.user);
  });

  // DELETE /work-orders/:id
  fastify.delete('/work-orders/:id', {
    preHandler: requireAuth,
    schema: { tags: ['Work Orders'], summary: 'Delete work order', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    await db.update(tables.work_orders, rowId(wo), { status: 'closed', updated_at: new Date().toISOString() });
    return { ok: true };
  });

  // Status transitions
  async function transitionStatus(id, user, status, extra = {}) {
    const wo = await getOwnedWorkOrder(id, user);
    if (!wo) return { error: 'Work order not found', code: 404 };
    const updated = await db.update(tables.work_orders, rowId(wo), {
      status,
      updated_at: new Date().toISOString(),
      ...extra,
    });
    return { wo: updated };
  }

  fastify.post('/work-orders/:id/start', {
    preHandler: requireAuth,
    schema: { tags: ['Work Orders'], summary: 'Start work order', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const now = new Date().toISOString();
    const result = await transitionStatus(req.params.id, req.user, 'in_progress', {
      started_at: now,
    });
    if (result.error) return reply.code(result.code).send({ error: result.error });
    return enrichWorkOrder(result.wo, req.user);
  });

  fastify.post('/work-orders/:id/pause', {
    preHandler: requireAuth,
    schema: { tags: ['Work Orders'], summary: 'Pause work order', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const result = await transitionStatus(req.params.id, req.user, 'on_hold');
    if (result.error) return reply.code(result.code).send({ error: result.error });
    return enrichWorkOrder(result.wo, req.user);
  });

  fastify.post('/work-orders/:id/complete', {
    preHandler: requireAuth,
    schema: { tags: ['Work Orders'], summary: 'Complete work order', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const now = new Date().toISOString();
    const result = await transitionStatus(req.params.id, req.user, 'completed', {
      completed_at: now,
    });
    if (result.error) return reply.code(result.code).send({ error: result.error });
    return enrichWorkOrder(result.wo, req.user);
  });

  fastify.post('/work-orders/:id/en-route', {
    preHandler: requireAuth,
    schema: {
      tags: ['Work Orders'],
      summary: 'Mark technician en route (shows on customer portal when beacon active)',
      security: [{ apiKey: [] }],
    },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    const isAssignee = wo.assignee_id && String(wo.assignee_id) === String(req.user.Id);
    if (!isAssignee && !(await canManageWorkOrder(req.user, wo))) {
      return reply.code(403).send({ error: 'Only the assignee or dispatch can mark en route' });
    }
    const now = new Date().toISOString();
    const patch = { en_route_at: now, updated_at: now };
    if (wo.status === 'scheduled' || wo.status === 'draft') patch.status = 'in_progress';
    const updated = await db.update(tables.work_orders, rowId(wo), patch);
    return enrichWorkOrder(updated, req.user);
  });

  fastify.post('/work-orders/:id/ack', {
    preHandler: requireAuth,
    schema: {
      tags: ['Work Orders'],
      summary: 'Radio/dispatch ack — assignee or dispatcher confirms receipt',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['role'],
        properties: {
          role: { type: 'string', enum: ['assignee', 'dispatch'] },
        },
      },
    },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    const now = new Date().toISOString();
    const patch = { updated_at: now };
    if (req.body.role === 'assignee') {
      const isAssignee = wo.assignee_id && String(wo.assignee_id) === String(req.user.Id);
      if (!isAssignee && !(await canManageWorkOrder(req.user, wo))) {
        return reply.code(403).send({ error: 'Only the assignee can ack as field tech' });
      }
      patch.assignee_ack_at = now;
    } else {
      if (!(await canManageWorkOrder(req.user, wo))) {
        return reply.code(403).send({ error: 'Only dispatch can ack assignment' });
      }
      patch.dispatch_ack_at = now;
    }
    const updated = await db.update(tables.work_orders, rowId(wo), patch);
    return enrichWorkOrder(updated, req.user);
  });

  // Incident links
  fastify.post('/work-orders/:id/incidents', {
    preHandler: requireAuth,
    schema: {
      tags: ['Work Orders'],
      summary: 'Link incident to work order',
      security: [{ apiKey: [] }],
      body: { type: 'object', required: ['ticket_id'], properties: { ticket_id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    const ticket = await db.get(tables.tickets, req.body.ticket_id);
    if (!ticket || !userOwnsRow(ticket, req.user)) return reply.code(404).send({ error: 'Incident not found' });

    const woId = String(rowId(wo));
    const existing = await db.find(tables.work_order_incidents,
      `(work_order_id,eq,${woId})~and(ticket_id,eq,${req.body.ticket_id})`);
    if (!existing.list?.length) {
      await db.create(tables.work_order_incidents, {
        work_order_id: woId,
        ticket_id: String(req.body.ticket_id),
      });
    }
    return enrichWorkOrder(wo, req.user);
  });

  fastify.delete('/work-orders/:id/incidents/:ticketId', {
    preHandler: requireAuth,
    schema: { tags: ['Work Orders'], summary: 'Unlink incident', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    const woId = String(rowId(wo));
    const links = await db.find(tables.work_order_incidents,
      `(work_order_id,eq,${woId})~and(ticket_id,eq,${req.params.ticketId})`);
    for (const link of links.list || []) {
      await db.delete(tables.work_order_incidents, rowId(link));
    }
    return enrichWorkOrder(wo, req.user);
  });

  // Booking link
  fastify.patch('/work-orders/:id/booking', {
    preHandler: requireAuth,
    schema: {
      tags: ['Work Orders'],
      summary: 'Link or unlink manifest assignment',
      security: [{ apiKey: [] }],
      body: { type: 'object', properties: { booking_id: { type: 'string', nullable: true } } },
    },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });

    const bookingId = req.body.booking_id;
    if (bookingId) {
      const booking = await db.get(tables.bookings, bookingId);
      if (!booking || !userOwnsRow(booking, req.user)) {
        return reply.code(404).send({ error: 'Assignment not found' });
      }
    }

    const updated = await db.update(tables.work_orders, rowId(wo), {
      booking_id: bookingId || null,
      updated_at: new Date().toISOString(),
    });
    return enrichWorkOrder(updated, req.user);
  });

  // Time entries
  fastify.get('/work-orders/:id/time', {
    preHandler: requireAuth,
    schema: { tags: ['Work Orders'], summary: 'List time entries', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    const r = await db.find(tables.work_order_time_entries,
      `(work_order_id,eq,${rowId(wo)})`, { sort: '-started_at', limit: 200 });
    return { time_entries: r.list || [] };
  });

  fastify.post('/work-orders/:id/time', {
    preHandler: requireAuth,
    schema: {
      tags: ['Work Orders'],
      summary: 'Add manual time entry',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['started_at'],
        properties: {
          entry_type: { type: 'string', enum: TIME_TYPES },
          started_at: { type: 'string' },
          ended_at: { type: 'string' },
          notes: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });

    const { entry_type = 'on_site', started_at, ended_at, notes } = req.body;
    if (!TIME_TYPES.includes(entry_type)) return reply.code(400).send({ error: 'Invalid entry_type' });

    let duration_minutes = null;
    if (ended_at) duration_minutes = calcDurationMinutes(started_at, ended_at);

    const entry = await db.create(tables.work_order_time_entries, {
      work_order_id: String(rowId(wo)),
      user_id: String(req.user.Id),
      entry_type,
      started_at,
      ended_at: ended_at || null,
      duration_minutes,
      notes: notes || '',
    });
    await db.update(tables.work_orders, rowId(wo), { updated_at: new Date().toISOString() });
    return reply.code(201).send(entry);
  });

  fastify.patch('/work-orders/:id/time/:entryId', {
    preHandler: requireAuth,
    schema: { tags: ['Work Orders'], summary: 'Update time entry', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    const entry = await db.get(tables.work_order_time_entries, req.params.entryId);
    if (!entry || String(entry.work_order_id) !== String(rowId(wo))) {
      return reply.code(404).send({ error: 'Time entry not found' });
    }

    const patch = {};
    for (const key of ['entry_type', 'started_at', 'ended_at', 'notes']) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    if (patch.started_at || patch.ended_at) {
      const start = patch.started_at || entry.started_at;
      const end = patch.ended_at || entry.ended_at;
      if (end) patch.duration_minutes = calcDurationMinutes(start, end);
    }

    const updated = await db.update(tables.work_order_time_entries, rowId(entry), patch);
    return updated;
  });

  fastify.delete('/work-orders/:id/time/:entryId', {
    preHandler: requireAuth,
    schema: { tags: ['Work Orders'], summary: 'Delete time entry', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    const entry = await db.get(tables.work_order_time_entries, req.params.entryId);
    if (!entry || String(entry.work_order_id) !== String(rowId(wo))) {
      return reply.code(404).send({ error: 'Time entry not found' });
    }
    await db.delete(tables.work_order_time_entries, rowId(entry));
    return { ok: true };
  });

  fastify.post('/work-orders/:id/time/clock-in', {
    preHandler: requireAuth,
    schema: {
      tags: ['Work Orders'],
      summary: 'Clock in on work order',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        properties: {
          entry_type: { type: 'string', enum: TIME_TYPES },
          notes: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });

    const woId = String(rowId(wo));
    const userId = String(req.user.Id);
    const active = await db.find(tables.work_order_time_entries,
      `(work_order_id,eq,${woId})~and(user_id,eq,${userId})~and(ended_at,eq,)`);
    if (active.list?.length) {
      return reply.code(409).send({ error: 'Already clocked in on this work order' });
    }

    const entry_type = req.body?.entry_type || 'on_site';
    const entry = await db.create(tables.work_order_time_entries, {
      work_order_id: woId,
      user_id: userId,
      entry_type,
      started_at: new Date().toISOString(),
      notes: req.body?.notes || '',
    });

    if (wo.status === 'draft' || wo.status === 'scheduled') {
      await db.update(tables.work_orders, rowId(wo), {
        status: 'in_progress',
        started_at: wo.started_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    return reply.code(201).send(entry);
  });

  fastify.post('/work-orders/:id/time/clock-out', {
    preHandler: requireAuth,
    schema: { tags: ['Work Orders'], summary: 'Clock out on work order', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });

    const woId = String(rowId(wo));
    const userId = String(req.user.Id);
    const active = await db.find(tables.work_order_time_entries,
      `(work_order_id,eq,${woId})~and(user_id,eq,${userId})~and(ended_at,eq,)`);
    const entry = active.list?.[0];
    if (!entry) return reply.code(404).send({ error: 'No active timer' });

    const ended_at = new Date().toISOString();
    const updated = await db.update(tables.work_order_time_entries, rowId(entry), {
      ended_at,
      duration_minutes: calcDurationMinutes(entry.started_at, ended_at),
    });
    return updated;
  });

  // Checklist
  fastify.get('/work-orders/:id/checklist', {
    preHandler: requireAuth,
    schema: { tags: ['Work Orders'], summary: 'List checklist items', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    const r = await db.find(tables.work_order_checklist_items,
      `(work_order_id,eq,${rowId(wo)})`, { sort: 'sort_order', limit: 200 });
    return { checklist: r.list || [] };
  });

  fastify.post('/work-orders/:id/checklist', {
    preHandler: requireAuth,
    schema: {
      tags: ['Work Orders'],
      summary: 'Add checklist item',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['label'],
        properties: {
          label: { type: 'string' },
          required: { type: 'boolean' },
          sort_order: { type: 'integer' },
        },
      },
    },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    const item = await db.create(tables.work_order_checklist_items, {
      work_order_id: String(rowId(wo)),
      label: req.body.label,
      required: !!req.body.required,
      sort_order: req.body.sort_order ?? 0,
    });
    return reply.code(201).send(item);
  });

  fastify.patch('/work-orders/:id/checklist/:itemId', {
    preHandler: requireAuth,
    schema: { tags: ['Work Orders'], summary: 'Update checklist item', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    const item = await db.get(tables.work_order_checklist_items, req.params.itemId);
    if (!item || String(item.work_order_id) !== String(rowId(wo))) {
      return reply.code(404).send({ error: 'Checklist item not found' });
    }

    const patch = {};
    for (const key of ['label', 'sort_order', 'required', 'completed']) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    if (patch.completed === true) {
      patch.completed_at = new Date().toISOString();
      patch.completed_by = String(req.user.Id);
    } else if (patch.completed === false) {
      patch.completed_at = null;
      patch.completed_by = null;
    }

    return db.update(tables.work_order_checklist_items, rowId(item), patch);
  });

  fastify.delete('/work-orders/:id/checklist/:itemId', {
    preHandler: requireAuth,
    schema: { tags: ['Work Orders'], summary: 'Delete checklist item', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    const item = await db.get(tables.work_order_checklist_items, req.params.itemId);
    if (!item || String(item.work_order_id) !== String(rowId(wo))) {
      return reply.code(404).send({ error: 'Checklist item not found' });
    }
    await db.delete(tables.work_order_checklist_items, rowId(item));
    return { ok: true };
  });

  // Line items
  fastify.get('/work-orders/:id/line-items', {
    preHandler: requireAuth,
    schema: { tags: ['Work Orders'], summary: 'List parts/materials', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    const r = await db.find(tables.work_order_line_items, `(work_order_id,eq,${rowId(wo)})`, { limit: 200 });
    return { line_items: r.list || [] };
  });

  fastify.post('/work-orders/:id/line-items', {
    preHandler: requireAuth,
    schema: {
      tags: ['Work Orders'],
      summary: 'Add line item',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['description'],
        properties: {
          description: { type: 'string' },
          sku: { type: 'string' },
          quantity: { type: 'number' },
          unit: { type: 'string' },
          unit_cost: { type: 'number' },
          notes: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    const item = await db.create(tables.work_order_line_items, {
      work_order_id: String(rowId(wo)),
      description: req.body.description,
      sku: req.body.sku || '',
      quantity: req.body.quantity ?? 1,
      unit: req.body.unit || '',
      unit_cost: req.body.unit_cost ?? null,
      notes: req.body.notes || '',
    });
    return reply.code(201).send(item);
  });

  fastify.patch('/work-orders/:id/line-items/:lineId', {
    preHandler: requireAuth,
    schema: { tags: ['Work Orders'], summary: 'Update line item', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    const item = await db.get(tables.work_order_line_items, req.params.lineId);
    if (!item || String(item.work_order_id) !== String(rowId(wo))) {
      return reply.code(404).send({ error: 'Line item not found' });
    }
    const patch = {};
    for (const key of ['description', 'sku', 'quantity', 'unit', 'unit_cost', 'notes']) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    return db.update(tables.work_order_line_items, rowId(item), patch);
  });

  fastify.delete('/work-orders/:id/line-items/:lineId', {
    preHandler: requireAuth,
    schema: { tags: ['Work Orders'], summary: 'Delete line item', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    const item = await db.get(tables.work_order_line_items, req.params.lineId);
    if (!item || String(item.work_order_id) !== String(rowId(wo))) {
      return reply.code(404).send({ error: 'Line item not found' });
    }
    await db.delete(tables.work_order_line_items, rowId(item));
    return { ok: true };
  });

  // Attachments
  fastify.get('/work-orders/:id/attachments', {
    preHandler: requireAuth,
    schema: { tags: ['Work Orders'], summary: 'List attachments', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    const r = await db.find(tables.work_order_attachments,
      `(work_order_id,eq,${rowId(wo)})`, { sort: '-created_at', limit: 200 });
    return { attachments: r.list || [] };
  });

  fastify.post('/work-orders/:id/attachments', {
    preHandler: requireAuth,
    schema: {
      tags: ['Work Orders'],
      summary: 'Register attachment metadata after upload',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string' },
          filename: { type: 'string' },
          mime_type: { type: 'string' },
          caption: { type: 'string' },
          category: { type: 'string', enum: ATTACHMENT_CATEGORIES },
        },
      },
    },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });

    const category = ATTACHMENT_CATEGORIES.includes(req.body.category) ? req.body.category : 'other';
    const att = await db.create(tables.work_order_attachments, {
      work_order_id: String(rowId(wo)),
      url: req.body.url,
      filename: req.body.filename || '',
      mime_type: req.body.mime_type || '',
      caption: req.body.caption || '',
      category,
      uploaded_by: String(req.user.Id),
    });
    return reply.code(201).send({ ...att, annotations: [] });
  });

  fastify.patch('/work-orders/:id/attachments/:attId', {
    preHandler: requireAuth,
    schema: {
      tags: ['Work Orders'],
      summary: 'Update attachment caption or photo markup',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        properties: {
          caption: { type: 'string' },
          category: { type: 'string', enum: ATTACHMENT_CATEGORIES },
          annotations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['arrow', 'line'] },
                x1: { type: 'number' },
                y1: { type: 'number' },
                x2: { type: 'number' },
                y2: { type: 'number' },
                color: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    const att = await db.get(tables.work_order_attachments, req.params.attId);
    if (!att || String(att.work_order_id) !== String(rowId(wo))) {
      return reply.code(404).send({ error: 'Attachment not found' });
    }
    const patch = {};
    if (req.body.caption !== undefined) patch.caption = req.body.caption;
    if (req.body.category !== undefined) {
      patch.category = ATTACHMENT_CATEGORIES.includes(req.body.category) ? req.body.category : att.category;
    }
    if (req.body.annotations !== undefined) {
      patch.annotations = JSON.stringify(req.body.annotations || []);
    }
    if (!Object.keys(patch).length) return reply.code(400).send({ error: 'No changes' });
    const updated = await db.update(tables.work_order_attachments, rowId(att), patch);
    return { ...updated, annotations: parseAnnotations(updated.annotations) };
  });

  fastify.delete('/work-orders/:id/attachments/:attId', {
    preHandler: requireAuth,
    schema: { tags: ['Work Orders'], summary: 'Delete attachment record', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    const att = await db.get(tables.work_order_attachments, req.params.attId);
    if (!att || String(att.work_order_id) !== String(rowId(wo))) {
      return reply.code(404).send({ error: 'Attachment not found' });
    }
    await db.delete(tables.work_order_attachments, rowId(att));
    return { ok: true };
  });

  // Signatures
  fastify.post('/work-orders/:id/signatures', {
    preHandler: requireAuth,
    schema: {
      tags: ['Work Orders'],
      summary: 'Add signature (technician)',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['signer_name', 'image_url'],
        properties: {
          role: { type: 'string', enum: SIGNATURE_ROLES },
          signer_name: { type: 'string' },
          image_url: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });

    const role = SIGNATURE_ROLES.includes(req.body.role) ? req.body.role : 'technician';
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const ip_hash = createHash('sha256').update(String(ip)).digest('hex').slice(0, 16);

    const sig = await db.create(tables.work_order_signatures, {
      work_order_id: String(rowId(wo)),
      role,
      signer_name: req.body.signer_name,
      image_url: req.body.image_url,
      signed_at: new Date().toISOString(),
      ip_hash,
    });

    if (role === 'technician') {
      await db.update(tables.work_orders, rowId(wo), {
        status: wo.status === 'completed' ? 'signed_off' : wo.status,
        updated_at: new Date().toISOString(),
      });
    }

    return reply.code(201).send(sig);
  });

  // PDF report
  fastify.get('/work-orders/:id/report.pdf', {
    preHandler: requireAuth,
    schema: { tags: ['Work Orders'], summary: 'Download evidence pack PDF', security: [{ apiKey: [] }] },
  }, async (req, reply) => {
    const wo = await getOwnedWorkOrder(req.params.id, req.user);
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    const enriched = await enrichWorkOrder(wo);
    const pdf = await generateWorkOrderPdf(enriched, baseUrl());
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="work-order-${wo.uid || rowId(wo)}.pdf"`)
      .send(pdf);
  });
}
