// src/routes/orgs.mjs — Org, team, member, event type management

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireSession } from '../middleware/session.mjs';
import { getLimits, planError } from './planLimits.mjs';
import { nanoid } from 'nanoid';
import { sendInvite } from '../lib/mailer.mjs';
import { addHours } from 'date-fns';

const TAG = 'Organizations';
const SEC = [{ apiKey: [] }];

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

// Returns true if this org is "over limit" for the user's plan (oldest N are protected)
async function isOrgOverLimit(userId, orgId, plan) {
  const limits = getLimits(plan);
  if (limits.orgs === Infinity) return false;
  if (limits.orgs === 0) return true; // all orgs are over limit
  const all = await db.find(tables.organizations, `(owner_user_id,eq,${userId})`, { sort: 'created_at', limit: 200 });
  const orgs = all.list || [];
  const allowed = orgs.slice(0, limits.orgs).map(o => String(o.Id));
  return !allowed.includes(String(orgId));
}

// Returns true if this team is over limit for the org owner's plan
async function isTeamOverLimit(ownerId, orgId, teamId, plan) {
  const limits = getLimits(plan);
  if (limits.teams_per_org === Infinity) return false;
  const all = await db.find(tables.teams, `(org_id,eq,${orgId})`, { sort: 'created_at', limit: 200 });
  const teams = all.list || [];
  const allowed = teams.slice(0, limits.teams_per_org).map(t => String(t.Id));
  return !allowed.includes(String(teamId));
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
      tags: [TAG], summary: 'Create an organization', security: SEC,
      description: 'Create a new organization. Requires an Enterprise account. The creator is automatically added as `owner`.',
      body: {
        type: 'object', required: ['name'],
        properties: {
          name: { type: 'string', description: 'Display name for the org' },
          slug: { type: 'string', description: 'URL-safe slug (auto-generated from name if omitted)' },
        },
        examples: [{ name: 'Alpha Response Team', slug: 'alpha-response' }],
      },
      response: {
        201: {
          type: 'object', additionalProperties: true,
          example: { Id: 4, name: 'Alpha Response Team', slug: 'alpha-response', owner_user_id: '7', api_key: 'p7s_org_abc123' },
        },
      },
    },
  }, async (req, reply) => {
    const plan = req.user.plan || 'free';
    const limits = getLimits(plan);
    if (limits.orgs === 0) {
      return reply.code(403).send(planError('organizations', 0, 1));
    }
    if (limits.orgs !== Infinity) {
      const existing_orgs = await db.find(tables.organizations, `(owner_user_id,eq,${req.user.Id})`);
      const orgCount = (existing_orgs.list || []).length;
      if (orgCount >= limits.orgs) {
        return reply.code(403).send(planError('organizations', limits.orgs, orgCount));
      }
    }

    const { name } = req.body;
    const slug = req.body.slug ? slugify(req.body.slug) : slugify(name);
    const api_key = nanoid(32);

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

  fastify.get('/orgs', {
    preHandler: requireSession,
    schema: {
      tags: [TAG], summary: 'List your organizations', security: SEC,
      description: 'Returns all organizations the authenticated user is a member of.',
      response: { 200: { type: 'object', additionalProperties: true, example: { orgs: [{ Id: 4, name: 'Alpha Response Team', slug: 'alpha-response' }] } } },
    },
  }, async (req) => {
    const memberships = await db.find(tables.org_members, `(user_id,eq,${req.user.Id})`);
    const orgs = await Promise.all(
      (memberships.list || []).map(m => db.get(tables.organizations, m.org_id))
    );
    return { orgs: orgs.filter(Boolean) };
  });

  fastify.get('/orgs/:org_slug', {
    preHandler: requireSession,
    schema: {
      tags: [TAG], summary: 'Get an organization', security: SEC,
      description: 'Returns org details, members, and teams. `api_key` is only included for the org owner.',
      params: { type: 'object', properties: { org_slug: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true, example: { org: { Id: 4, name: 'Alpha Response Team', slug: 'alpha-response' }, members: [{ role: 'owner', user: { email: 'ops@schedkit.net', name: 'Olson Ops' } }], teams: [] } } },
    },
  }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply);
    if (!ctx) return;
    const { org } = ctx;

    const [membersResult, teamsResult] = await Promise.all([
      db.find(tables.org_members, `(org_id,eq,${org.Id})`),
      db.find(tables.teams, `(org_id,eq,${org.Id})`),
    ]);

    const members = await Promise.all(
      (membersResult.list || []).map(async m => {
        const user = await db.get(tables.users, m.user_id);
        return { ...m, user: user ? { Id: user.Id, email: user.email, name: user.name } : null };
      })
    );

    const { api_key, ...orgSafe } = org;
    const isOwner = String(org.owner_user_id) === String(req.user.Id);

    return { org: isOwner ? org : orgSafe, members, teams: teamsResult.list || [] };
  });

  fastify.patch('/orgs/:org_slug', {
    preHandler: requireSession,
    schema: {
      tags: [TAG], summary: 'Update an organization', security: SEC,
      description: 'Update the org name or slug. Requires `admin` role.',
      params: { type: 'object', properties: { org_slug: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          slug: { type: 'string' },
        },
        examples: [{ name: 'Alpha Response HQ', slug: 'alpha-response-hq' }],
      },
      response: { 200: { type: 'object', additionalProperties: true, example: { Id: 4, name: 'Alpha Response HQ', slug: 'alpha-response-hq' } } },
    },
  }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'admin');
    if (!ctx) return;
    const { org } = ctx;

    const plan = req.user.plan || 'free';
    if (await isOrgOverLimit(req.user.Id, org.Id, plan)) {
      return reply.code(403).send({ error: 'This org is read-only on your current plan. Upgrade to manage it.', upgrade_url: 'https://schedkit.net/#pricing' });
    }

    const updates = {};
    if (req.body.name) updates.name = req.body.name;
    if (req.body.slug) updates.slug = slugify(req.body.slug);

    const updated = await db.update(tables.organizations, org.Id, updates);
    return updated;
  });

  // ── Org Settings (email branding) ────────────────────────────────

  fastify.patch('/orgs/:org_slug/settings', {
    preHandler: requireSession,
    schema: {
      tags: [TAG], summary: 'Update org email settings', security: SEC,
      description: 'Update email branding for the org. Requires `admin` role. `ticket_subject_template` supports tokens: `%ticket_id%`, `%title%`, `%priority%`, `%org_name%`. `ticket_from_prefix` sets the sender name prefix (e.g. `SchedKit-INC` → `SchedKit-INC9`).',
      params: { type: 'object', properties: { org_slug: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          ticket_subject_template: { type: 'string', description: 'Email subject template. Tokens: %ticket_id%, %title%, %priority%, %org_name%' },
          ticket_from_prefix: { type: 'string', description: 'From name prefix for ticket emails (e.g. "SchedKit-INC" → "SchedKit-INC9")' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'admin');
    if (!ctx) return;
    const { org } = ctx;

    const updates = {};
    if (req.body.ticket_subject_template !== undefined) updates.ticket_subject_template = req.body.ticket_subject_template;
    if (req.body.ticket_from_prefix !== undefined) updates.ticket_from_prefix = req.body.ticket_from_prefix;

    const updated = await db.update(tables.organizations, org.Id, updates);
    return updated;
  });

  fastify.delete('/orgs/:org_slug', {
    preHandler: requireSession,
    schema: {
      tags: [TAG], summary: 'Delete an organization', security: SEC,
      description: 'Permanently deletes the org. Requires `owner` role.',
      params: { type: 'object', properties: { org_slug: { type: 'string' } } },
      response: { 200: { type: 'object', properties: { ok: { type: 'boolean' } }, example: { ok: true } } },
    },
  }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'owner');
    if (!ctx) return;
    await db.delete(tables.organizations, ctx.org.Id);
    return { ok: true };
  });

  // ── Org Members ───────────────────────────────────────────────────

  fastify.post('/orgs/:org_slug/members', {
    preHandler: requireSession,
    schema: {
      tags: [TAG], summary: 'Add a member to an org', security: SEC,
      description: 'Add an existing SchedKit user to the org by email. Requires `admin` role.',
      params: { type: 'object', properties: { org_slug: { type: 'string' } } },
      body: {
        type: 'object', required: ['email', 'role'],
        properties: {
          email: { type: 'string' },
          role: { type: 'string', enum: ['admin', 'member'] },
        },
        examples: [{ email: 'alex@example.com', role: 'member' }],
      },
      response: { 201: { type: 'object', additionalProperties: true, example: { Id: 19, org_id: '4', user_id: '12', role: 'member' } } },
    },
  }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'admin');
    if (!ctx) return;
    const { org } = ctx;

    const userResult = await db.find(tables.users, `(email,eq,${req.body.email})`);
    if (!userResult.list?.length) return reply.code(404).send({ error: 'User not found' });
    const user = userResult.list[0];

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
      tags: [TAG], summary: 'Update a member\'s role', security: SEC,
      description: 'Change the role of an org member. Requires `admin`.',
      params: { type: 'object', properties: { org_slug: { type: 'string' }, user_id: { type: 'string' } } },
      body: {
        type: 'object', required: ['role'],
        properties: { role: { type: 'string', enum: ['admin', 'member'] } },
        examples: [{ role: 'admin' }],
      },
      response: { 200: { type: 'object', additionalProperties: true, example: { Id: 19, org_id: '4', user_id: '12', role: 'admin' } } },
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

  fastify.delete('/orgs/:org_slug/members/:user_id', {
    preHandler: requireSession,
    schema: {
      tags: [TAG], summary: 'Remove a member from an org', security: SEC,
      description: 'Removes the user from the org. Requires `admin`.',
      params: { type: 'object', properties: { org_slug: { type: 'string' }, user_id: { type: 'string' } } },
      response: { 200: { type: 'object', properties: { ok: { type: 'boolean' } }, example: { ok: true } } },
    },
  }, async (req, reply) => {
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
      tags: [TAG], summary: 'Create a team', security: SEC,
      description: 'Create a team within an org. `routing` controls how bookings are assigned to members: `round_robin` rotates in order, `random` picks randomly.',
      params: { type: 'object', properties: { org_slug: { type: 'string' } } },
      body: {
        type: 'object', required: ['name', 'routing'],
        properties: {
          name: { type: 'string' },
          slug: { type: 'string', description: 'URL-safe slug (auto-generated from name if omitted)' },
          routing: { type: 'string', enum: ['round_robin', 'random'], description: '`round_robin` rotates assignments; `random` picks any available member' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'admin');
    if (!ctx) return;
    const { org } = ctx;

    // Plan enforcement: teams per org
    const plan = req.user.plan || 'free';
    const limits = getLimits(plan);
    if (limits.teams_per_org !== Infinity) {
      const existing_teams = await db.find(tables.teams, `(org_id,eq,${org.Id})`);
      const teamCount = (existing_teams.list || []).length;
      if (teamCount >= limits.teams_per_org) {
        return reply.code(403).send(planError('teams per org', limits.teams_per_org, teamCount));
      }
    }

    const slug = req.body.slug ? slugify(req.body.slug) : slugify(req.body.name);
    const team = await db.create(tables.teams, {
      org_id: String(org.Id), name: req.body.name, slug, routing: req.body.routing, last_assigned_index: 0,
    });
    return reply.code(201).send(team);
  });

  fastify.get('/orgs/:org_slug/teams', {
    preHandler: requireSession,
    schema: {
      tags: [TAG], summary: 'List teams in an org', security: SEC,
      params: { type: 'object', properties: { org_slug: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply);
    if (!ctx) return;
    const r = await db.find(tables.teams, `(org_id,eq,${ctx.org.Id})`);
    return { teams: r.list || [] };
  });

  fastify.patch('/orgs/:org_slug/teams/:team_slug', {
    preHandler: requireSession,
    schema: {
      tags: [TAG], summary: 'Update a team', security: SEC,
      params: { type: 'object', properties: { org_slug: { type: 'string' }, team_slug: { type: 'string' } } },
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

    const plan = req.user.plan || 'free';
    if (await isOrgOverLimit(req.user.Id, ctx.org.Id, plan)) {
      return reply.code(403).send({ error: 'This org is read-only on your current plan. Upgrade to manage it.', upgrade_url: 'https://schedkit.net/#pricing' });
    }
    if (await isTeamOverLimit(req.user.Id, ctx.org.Id, team.Id, plan)) {
      return reply.code(403).send({ error: 'This team is read-only on your current plan. Upgrade to manage it.', upgrade_url: 'https://schedkit.net/#pricing' });
    }

    const updates = {};
    if (req.body.name) updates.name = req.body.name;
    if (req.body.slug) updates.slug = slugify(req.body.slug);
    if (req.body.routing) updates.routing = req.body.routing;

    return db.update(tables.teams, team.Id, updates);
  });

  fastify.delete('/orgs/:org_slug/teams/:team_slug', {
    preHandler: requireSession,
    schema: {
      tags: [TAG], summary: 'Delete a team', security: SEC,
      params: { type: 'object', properties: { org_slug: { type: 'string' }, team_slug: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'admin');
    if (!ctx) return;

    const team = await getTeamBySlug(ctx.org.Id, req.params.team_slug);
    if (!team) return reply.code(404).send({ error: 'Team not found' });

    await db.delete(tables.teams, team.Id);
    return { ok: true };
  });

  // ── Team Members ──────────────────────────────────────────────────

  fastify.get('/orgs/:org_slug/teams/:team_slug/members', {
    preHandler: requireSession,
    schema: {
      tags: [TAG], summary: 'List team members', security: SEC,
      description: 'Returns team members enriched with user name and email.',
      params: { type: 'object', properties: { org_slug: { type: 'string' }, team_slug: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'member');
    if (!ctx) return;
    const team = await getTeamBySlug(ctx.org.Id, req.params.team_slug);
    if (!team) return reply.code(404).send({ error: 'Team not found' });

    const tmResult = await db.find(tables.team_members, `(team_id,eq,${team.Id})`, { limit: 100 });
    const members = tmResult.list || [];

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
      tags: [TAG], summary: 'Add a member to a team', security: SEC,
      description: 'Add an org member to a team. Provide `email` (preferred) or `user_id`.',
      params: { type: 'object', properties: { org_slug: { type: 'string' }, team_slug: { type: 'string' } } },
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

    let targetUserId = req.body.user_id;
    if (req.body.email) {
      const ur = await db.find(tables.users, `(email,eq,${req.body.email})`);
      const u = ur.list?.[0];
      if (!u) return reply.code(404).send({ error: `No user found with email ${req.body.email}` });
      targetUserId = String(u.Id);
    }
    if (!targetUserId) return reply.code(400).send({ error: 'email or user_id required' });

    // Plan enforcement: team members
    const plan = req.user.plan || 'free';
    const limits = getLimits(plan);
    if (limits.team_members !== Infinity) {
      const allMembers = await db.find(tables.team_members, `(team_id,eq,${team.Id})`, { limit: 200 });
      const memberCount = (allMembers.list || []).length;
      if (memberCount >= limits.team_members) {
        return reply.code(403).send(planError('team members', limits.team_members, memberCount));
      }
    }

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
      tags: [TAG], summary: 'Enable or disable a team member', security: SEC,
      description: 'Toggle a team member\'s `active` status. Inactive members are excluded from booking assignment.',
      params: { type: 'object', properties: { org_slug: { type: 'string' }, team_slug: { type: 'string' }, user_id: { type: 'string' } } },
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

  fastify.delete('/orgs/:org_slug/teams/:team_slug/members/:user_id', {
    preHandler: requireSession,
    schema: {
      tags: [TAG], summary: 'Remove a member from a team', security: SEC,
      params: { type: 'object', properties: { org_slug: { type: 'string' }, team_slug: { type: 'string' }, user_id: { type: 'string' } } },
    },
  }, async (req, reply) => {
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
      tags: [TAG], summary: 'Create a team event type', security: SEC,
      description: 'Create a bookable event type for a team. The public booking URL is `/book/:org_slug/:team_slug/:slug`. Bookings are auto-assigned to a team member based on the team\'s `routing` setting.',
      params: { type: 'object', properties: { org_slug: { type: 'string' }, team_slug: { type: 'string' } } },
      body: {
        type: 'object', required: ['title', 'duration_minutes'],
        properties: {
          title: { type: 'string' },
          slug: { type: 'string', description: 'URL slug (auto-generated from title if omitted)' },
          duration_minutes: { type: 'integer' },
          buffer_before: { type: 'integer', description: 'Buffer before event (minutes)' },
          buffer_after: { type: 'integer', description: 'Buffer after event (minutes)' },
          location: { type: 'string' },
          location_type: { type: 'string', enum: ['video', 'phone', 'in_person', 'other'] },
          description: { type: 'string' },
          appointment_label: { type: 'string', default: 'meeting' },
          min_notice_minutes: { type: 'integer', description: 'Minimum advance notice required to book' },
          webhook_url: { type: 'string' },
          custom_fields: { type: 'string', description: 'JSON array of custom field definitions' },
          requires_confirmation: { type: 'boolean' },
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
      location_type: req.body.location_type || null,
      description: req.body.description || '',
      appointment_label: req.body.appointment_label || 'meeting',
      min_notice_minutes: req.body.min_notice_minutes || 0,
      webhook_url: req.body.webhook_url || '',
      custom_fields: req.body.custom_fields || '[]',
      requires_confirmation: !!req.body.requires_confirmation,
    });
    return reply.code(201).send(et);
  });

  fastify.get('/orgs/:org_slug/teams/:team_slug/event-types', {
    preHandler: requireSession,
    schema: {
      tags: [TAG], summary: 'List team event types', security: SEC,
      params: { type: 'object', properties: { org_slug: { type: 'string' }, team_slug: { type: 'string' } } },
    },
  }, async (req, reply) => {
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
      tags: [TAG], summary: 'Update a team event type', security: SEC,
      params: { type: 'object', properties: { org_slug: { type: 'string' }, team_slug: { type: 'string' }, et_slug: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          slug: { type: 'string' },
          duration_minutes: { type: 'integer' },
          buffer_before: { type: 'integer' },
          buffer_after: { type: 'integer' },
          location: { type: 'string' },
          location_type: { type: 'string', enum: ['video', 'phone', 'in_person', 'other'] },
          description: { type: 'string' },
          appointment_label: { type: 'string' },
          min_notice_minutes: { type: 'integer' },
          webhook_url: { type: 'string' },
          custom_fields: { type: 'string' },
          requires_confirmation: { type: 'boolean' },
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
    const fields = ['title', 'slug', 'duration_minutes', 'buffer_before', 'buffer_after',
      'location', 'location_type', 'description', 'appointment_label', 'min_notice_minutes', 'webhook_url', 'custom_fields'];
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = f === 'slug' ? slugify(req.body[f]) : req.body[f];
    }
    if (req.body.requires_confirmation !== undefined) updates.requires_confirmation = !!req.body.requires_confirmation;

    return db.update(tables.team_event_types, et.Id, updates);
  });

  fastify.delete('/orgs/:org_slug/teams/:team_slug/event-types/:et_slug', {
    preHandler: requireSession,
    schema: {
      tags: [TAG], summary: 'Delete a team event type', security: SEC,
      params: { type: 'object', properties: { org_slug: { type: 'string' }, team_slug: { type: 'string' }, et_slug: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'admin');
    if (!ctx) return;

    const team = await getTeamBySlug(ctx.org.Id, req.params.team_slug);
    if (!team) return reply.code(404).send({ error: 'Team not found' });

    const et = await getTeamETBySlug(team.Id, req.params.et_slug);
    if (!et) return reply.code(404).send({ error: 'Event type not found' });

    await db.delete(tables.team_event_types, et.Id);
    return { ok: true };
  });

  // ── Invite ────────────────────────────────────────────────────────

  fastify.post('/orgs/:org_slug/invite', {
    preHandler: requireSession,
    schema: {
      tags: [TAG], summary: 'Invite a user to an org', security: SEC,
      description: 'Send an email invite to join the org. If the email is not yet registered, a stub user is created and a 24-hour magic-link login is included in the invite email.',
      params: { type: 'object', properties: { org_slug: { type: 'string' } } },
      body: {
        type: 'object', required: ['email', 'role'],
        properties: {
          email: { type: 'string' },
          role: { type: 'string', enum: ['admin', 'member'] },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = await requireOrgAccess(req, reply, 'admin');
    if (!ctx) return;
    const { org } = ctx;

    const email = req.body.email.toLowerCase().trim();

    let user;
    const existing = await db.find(tables.users, `(email,eq,${email})`);
    if (existing.list?.length) {
      user = existing.list[0];
      const isMember = await db.find(tables.org_members, `(org_id,eq,${org.Id})~and(user_id,eq,${user.Id})`);
      if (isMember.list?.length) return reply.code(409).send({ error: 'Already a member of this org' });
    } else {
      const emailPrefix = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      let slug = emailPrefix;
      const slugCheck = await db.find(tables.users, `(slug,eq,${slug})`);
      if (slugCheck.list?.length) slug = `${emailPrefix}-${nanoid(4)}`;
      const api_key = `p7s_${nanoid(32)}`;
      user = await db.create(tables.users, {
        email, name: '', slug, timezone: 'UTC', api_key, active: true, invited: true,
      });
    }

    await db.create(tables.org_members, {
      org_id: String(org.Id), user_id: String(user.Id), role: req.body.role,
    });

    const token = nanoid(40);
    await db.create(tables.magic_links, {
      token,
      user_id: String(user.Id),
      expires_at: addHours(new Date(), 24).toISOString(),
      used: false,
    });

    const BASE_DOMAIN = process.env.BASE_DOMAIN || 'schedkit.net';
    const link = `https://${BASE_DOMAIN}/v1/auth/verify?token=${token}`;

    await sendInvite({
      to: email,
      inviterName: req.user.name || req.user.email,
      orgName: org.name,
      link,
    });

    return reply.code(201).send({ ok: true, invited: !existing.list?.length });
  });
}
