// src/routes/orgs.mjs — Org, team, member, event type management

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireSession } from '../middleware/session.mjs';
import { nanoid } from 'nanoid';

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function getOrgBySlug(slug) {
  const r = await db.find(tables.organizations, `(slug,eq,${slug})`);
  return r.list?.[0] || null;
}

async function requireOrgAccess(req, reply, minRole = 'member') {
  const org = await getOrgBySlug(req.params.org_slug);
  if (!org) { reply.code(404).send({ error: 'Org not found' }); return null; }

  const mr = await db.find(tables.org_members, `(org_id,eq,${org.Id})~and(user_id,eq,${req.user.Id})`);
  const member = mr.list?.[0];
  if (!member) { reply.code(403).send({ error: 'Not a member of this org' }); return null; }

  const roleRank = { owner: 3, admin: 2, member: 1 };
  if ((roleRank[member.role] || 0) < (roleRank[minRole] || 0)) {
    reply.code(403).send({ error: 'Insufficient role' }); return null;
  }

  return { org, member };
}

async function getTeamBySlug(orgId, teamSlug) {
  const r = await db.find(tables.teams, `(org_id,eq,${orgId})~and(slug,eq,${teamSlug})`);
  return r.list?.[0] || null;
}

async function getTeamETBySlug(teamId, etSlug) {
  const r = await db.find(tables.team_event_types, `(team_id,eq,${teamId})~and(slug,eq,${etSlug})`);
  return r.list?.[0] || null;
}

export default async function orgsRoutes(fastify) {

  // ── Orgs ──────────────────────────────────────────────────────────

  fastify.post('/orgs', {
    preHandler: requireSession,
    schema: {
      body: {
        type: 'object', required: ['name'],
        properties: { name: { type: 'string' }, slug: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    // Enterprise gate
    if (!req.user.enterprise) {
      return reply.code(403).send({ error: 'Organizations require an Enterprise account. Contact support to upgrade.' });
    }

    const { name } = req.body;
    const slug = req.body.slug ? slugify(req.body.slug) : slugify(name);
    const api_key = nanoid(32);

    // Check slug uniqueness
    const existing = await db.find(tables.organizations, `(slug,eq,${slug})`);
    if (existing.list?.length) return reply.code(409).send({ error: 'Slug already taken' });

    const org = await db.create(tables.organizations, {
      name, slug, owner_user_id: String(req.user.Id), api_key,
    });

    await db.create(tables.org_members, {
      org_id: String(org.Id), user_id: String(req.user.Id), role: 'owner',
    });

    return reply.code(201).send(org);
  });

  fastify.get('/orgs', { preHandler: requireSession }, async (req) => {
    const memberships = await db.find(tables.org_members, `(user_id,eq,${req.user.Id})`);
    const orgs = await Promise.all(
      (memberships.list || []).map(m => db.get(tables.organizations, m.org_id))
    );
    return { orgs: orgs.filter(Boolean) };
  });

  fastify.get('/orgs/:org_slug', { preHandler: requireSession }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply);
    if (!ctx) return;
    const { org } = ctx;

    const [membersResult, teamsResult] = await Promise.all([
      db.find(tables.org_members, `(org_id,eq,${org.Id})`),
      db.find(tables.teams, `(org_id,eq,${org.Id})`),
    ]);

    // Enrich members with user info
    const members = await Promise.all(
      (membersResult.list || []).map(async m => {
        const user = await db.get(tables.users, m.user_id);
        return { ...m, user: user ? { Id: user.Id, email: user.email, name: user.name } : null };
      })
    );

    return { org, members, teams: teamsResult.list || [] };
  });

  fastify.patch('/orgs/:org_slug', {
    preHandler: requireSession,
    schema: {
      body: {
        type: 'object',
        properties: { name: { type: 'string' }, slug: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'admin');
    if (!ctx) return;
    const { org } = ctx;

    const updates = {};
    if (req.body.name) updates.name = req.body.name;
    if (req.body.slug) updates.slug = slugify(req.body.slug);

    const updated = await db.update(tables.organizations, org.Id, updates);
    return updated;
  });

  fastify.delete('/orgs/:org_slug', { preHandler: requireSession }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'owner');
    if (!ctx) return;
    await db.delete(tables.organizations, ctx.org.Id);
    return { ok: true };
  });

  // ── Org Members ───────────────────────────────────────────────────

  fastify.post('/orgs/:org_slug/members', {
    preHandler: requireSession,
    schema: {
      body: {
        type: 'object', required: ['email', 'role'],
        properties: { email: { type: 'string' }, role: { type: 'string', enum: ['admin', 'member'] } },
      },
    },
  }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'admin');
    if (!ctx) return;
    const { org } = ctx;

    const userResult = await db.find(tables.users, `(email,eq,${req.body.email})`);
    if (!userResult.list?.length) return reply.code(404).send({ error: 'User not found' });
    const user = userResult.list[0];

    // Check already a member
    const existing = await db.find(tables.org_members, `(org_id,eq,${org.Id})~and(user_id,eq,${user.Id})`);
    if (existing.list?.length) return reply.code(409).send({ error: 'Already a member' });

    const member = await db.create(tables.org_members, {
      org_id: String(org.Id), user_id: String(user.Id), role: req.body.role,
    });
    return reply.code(201).send(member);
  });

  fastify.patch('/orgs/:org_slug/members/:user_id', {
    preHandler: requireSession,
    schema: {
      body: {
        type: 'object', required: ['role'],
        properties: { role: { type: 'string', enum: ['admin', 'member'] } },
      },
    },
  }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'admin');
    if (!ctx) return;
    const { org } = ctx;

    const mr = await db.find(tables.org_members, `(org_id,eq,${org.Id})~and(user_id,eq,${req.params.user_id})`);
    if (!mr.list?.length) return reply.code(404).send({ error: 'Member not found' });

    const updated = await db.update(tables.org_members, mr.list[0].Id, { role: req.body.role });
    return updated;
  });

  fastify.delete('/orgs/:org_slug/members/:user_id', { preHandler: requireSession }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'admin');
    if (!ctx) return;
    const { org } = ctx;

    const mr = await db.find(tables.org_members, `(org_id,eq,${org.Id})~and(user_id,eq,${req.params.user_id})`);
    if (!mr.list?.length) return reply.code(404).send({ error: 'Member not found' });

    await db.delete(tables.org_members, mr.list[0].Id);
    return { ok: true };
  });

  // ── Teams ─────────────────────────────────────────────────────────

  fastify.post('/orgs/:org_slug/teams', {
    preHandler: requireSession,
    schema: {
      body: {
        type: 'object', required: ['name', 'routing'],
        properties: {
          name: { type: 'string' },
          slug: { type: 'string' },
          routing: { type: 'string', enum: ['round_robin', 'random'] },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'admin');
    if (!ctx) return;
    const { org } = ctx;

    const slug = req.body.slug ? slugify(req.body.slug) : slugify(req.body.name);
    const team = await db.create(tables.teams, {
      org_id: String(org.Id), name: req.body.name, slug, routing: req.body.routing, last_assigned_index: 0,
    });
    return reply.code(201).send(team);
  });

  fastify.get('/orgs/:org_slug/teams', { preHandler: requireSession }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply);
    if (!ctx) return;
    const r = await db.find(tables.teams, `(org_id,eq,${ctx.org.Id})`);
    return { teams: r.list || [] };
  });

  fastify.patch('/orgs/:org_slug/teams/:team_slug', {
    preHandler: requireSession,
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          slug: { type: 'string' },
          routing: { type: 'string', enum: ['round_robin', 'random'] },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'admin');
    if (!ctx) return;

    const team = await getTeamBySlug(ctx.org.Id, req.params.team_slug);
    if (!team) return reply.code(404).send({ error: 'Team not found' });

    const updates = {};
    if (req.body.name) updates.name = req.body.name;
    if (req.body.slug) updates.slug = slugify(req.body.slug);
    if (req.body.routing) updates.routing = req.body.routing;

    return db.update(tables.teams, team.Id, updates);
  });

  fastify.delete('/orgs/:org_slug/teams/:team_slug', { preHandler: requireSession }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'admin');
    if (!ctx) return;

    const team = await getTeamBySlug(ctx.org.Id, req.params.team_slug);
    if (!team) return reply.code(404).send({ error: 'Team not found' });

    await db.delete(tables.teams, team.Id);
    return { ok: true };
  });

  // ── Team Members ──────────────────────────────────────────────────

  // List team members (with user details)
  fastify.get('/orgs/:org_slug/teams/:team_slug/members', { preHandler: requireSession }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'member');
    if (!ctx) return;
    const team = await getTeamBySlug(ctx.org.Id, req.params.team_slug);
    if (!team) return reply.code(404).send({ error: 'Team not found' });

    const tmResult = await db.find(tables.team_members, `(team_id,eq,${team.Id})`, { limit: 100 });
    const members = tmResult.list || [];

    // Enrich with user info
    const enriched = await Promise.all(members.map(async m => {
      const ur = await db.find(tables.users, `(Id,eq,${m.user_id})`);
      const user = ur.list?.[0];
      return { ...m, user: user ? { email: user.email, name: user.name } : null };
    }));

    return { members: enriched };
  });

  fastify.post('/orgs/:org_slug/teams/:team_slug/members', {
    preHandler: requireSession,
    schema: {
      body: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email of the user to add (preferred)' },
          user_id: { type: 'string', description: 'User ID (fallback)' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'admin');
    if (!ctx) return;

    const team = await getTeamBySlug(ctx.org.Id, req.params.team_slug);
    if (!team) return reply.code(404).send({ error: 'Team not found' });

    // Resolve user by email or user_id
    let targetUserId = req.body.user_id;
    if (req.body.email) {
      const ur = await db.find(tables.users, `(email,eq,${req.body.email})`);
      const u = ur.list?.[0];
      if (!u) return reply.code(404).send({ error: `No user found with email ${req.body.email}` });
      targetUserId = String(u.Id);
    }
    if (!targetUserId) return reply.code(400).send({ error: 'email or user_id required' });

    const existing = await db.find(tables.team_members, `(team_id,eq,${team.Id})~and(user_id,eq,${targetUserId})`);
    if (existing.list?.length) return reply.code(409).send({ error: 'Already a team member' });

    const tm = await db.create(tables.team_members, {
      team_id: String(team.Id), user_id: targetUserId, active: true,
    });
    return reply.code(201).send(tm);
  });

  fastify.patch('/orgs/:org_slug/teams/:team_slug/members/:user_id', {
    preHandler: requireSession,
    schema: {
      body: {
        type: 'object', required: ['active'],
        properties: { active: { type: 'boolean' } },
      },
    },
  }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'admin');
    if (!ctx) return;

    const team = await getTeamBySlug(ctx.org.Id, req.params.team_slug);
    if (!team) return reply.code(404).send({ error: 'Team not found' });

    const tmr = await db.find(tables.team_members, `(team_id,eq,${team.Id})~and(user_id,eq,${req.params.user_id})`);
    if (!tmr.list?.length) return reply.code(404).send({ error: 'Team member not found' });

    return db.update(tables.team_members, tmr.list[0].Id, { active: req.body.active });
  });

  fastify.delete('/orgs/:org_slug/teams/:team_slug/members/:user_id', { preHandler: requireSession }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'admin');
    if (!ctx) return;

    const team = await getTeamBySlug(ctx.org.Id, req.params.team_slug);
    if (!team) return reply.code(404).send({ error: 'Team not found' });

    const tmr = await db.find(tables.team_members, `(team_id,eq,${team.Id})~and(user_id,eq,${req.params.user_id})`);
    if (!tmr.list?.length) return reply.code(404).send({ error: 'Team member not found' });

    await db.delete(tables.team_members, tmr.list[0].Id);
    return { ok: true };
  });

  // ── Team Event Types ──────────────────────────────────────────────

  fastify.post('/orgs/:org_slug/teams/:team_slug/event-types', {
    preHandler: requireSession,
    schema: {
      body: {
        type: 'object', required: ['title', 'duration_minutes'],
        properties: {
          title: { type: 'string' },
          slug: { type: 'string' },
          duration_minutes: { type: 'integer' },
          buffer_before: { type: 'integer' },
          buffer_after: { type: 'integer' },
          buffer_minutes: { type: 'integer' },
          location: { type: 'string' },
          location_type: { type: 'string' },
          description: { type: 'string' },
          appointment_label: { type: 'string' },
          min_notice_minutes: { type: 'integer' },
          webhook_url: { type: 'string' },
          custom_fields: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'admin');
    if (!ctx) return;

    const team = await getTeamBySlug(ctx.org.Id, req.params.team_slug);
    if (!team) return reply.code(404).send({ error: 'Team not found' });

    const slug = req.body.slug ? slugify(req.body.slug) : slugify(req.body.title);
    const et = await db.create(tables.team_event_types, {
      team_id: String(team.Id),
      title: req.body.title,
      slug,
      duration_minutes: req.body.duration_minutes,
      buffer_before: req.body.buffer_before ?? req.body.buffer_minutes ?? 0,
      buffer_after: req.body.buffer_after ?? 0,
      location: req.body.location || '',
      location_type: req.body.location_type || '',
      description: req.body.description || '',
      appointment_label: req.body.appointment_label || 'meeting',
      min_notice_minutes: req.body.min_notice_minutes || 0,
      webhook_url: req.body.webhook_url || '',
      custom_fields: req.body.custom_fields || '[]',
    });
    return reply.code(201).send(et);
  });

  fastify.get('/orgs/:org_slug/teams/:team_slug/event-types', { preHandler: requireSession }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply);
    if (!ctx) return;

    const team = await getTeamBySlug(ctx.org.Id, req.params.team_slug);
    if (!team) return reply.code(404).send({ error: 'Team not found' });

    const r = await db.find(tables.team_event_types, `(team_id,eq,${team.Id})`);
    return { event_types: r.list || [] };
  });

  fastify.patch('/orgs/:org_slug/teams/:team_slug/event-types/:et_slug', {
    preHandler: requireSession,
    schema: {
      body: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          slug: { type: 'string' },
          duration_minutes: { type: 'integer' },
          buffer_before: { type: 'integer' },
          buffer_after: { type: 'integer' },
          buffer_minutes: { type: 'integer' },
          location: { type: 'string' },
          location_type: { type: 'string' },
          description: { type: 'string' },
          appointment_label: { type: 'string' },
          min_notice_minutes: { type: 'integer' },
          webhook_url: { type: 'string' },
          custom_fields: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'admin');
    if (!ctx) return;

    const team = await getTeamBySlug(ctx.org.Id, req.params.team_slug);
    if (!team) return reply.code(404).send({ error: 'Team not found' });

    const et = await getTeamETBySlug(team.Id, req.params.et_slug);
    if (!et) return reply.code(404).send({ error: 'Event type not found' });

    const updates = {};
    const fields = ['title', 'slug', 'duration_minutes', 'buffer_before', 'buffer_after', 'buffer_minutes',
      'location', 'location_type', 'description', 'appointment_label', 'min_notice_minutes', 'webhook_url', 'custom_fields'];
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = f === 'slug' ? slugify(req.body[f]) : req.body[f];
    }

    return db.update(tables.team_event_types, et.Id, updates);
  });

  fastify.delete('/orgs/:org_slug/teams/:team_slug/event-types/:et_slug', { preHandler: requireSession }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'admin');
    if (!ctx) return;

    const team = await getTeamBySlug(ctx.org.Id, req.params.team_slug);
    if (!team) return reply.code(404).send({ error: 'Team not found' });

    const et = await getTeamETBySlug(team.Id, req.params.et_slug);
    if (!et) return reply.code(404).send({ error: 'Event type not found' });

    await db.delete(tables.team_event_types, et.Id);
    return { ok: true };
  });
}
