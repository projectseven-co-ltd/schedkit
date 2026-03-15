// src/routes/teamBookingPage.mjs — Team booking page + booking creation

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { nanoid } from 'nanoid';
import { addMinutes, parseISO } from 'date-fns';
import { sendBookingConfirmation } from '../lib/mailer.mjs';

// Check if a user has availability at a given start_time (ISO string)
async function memberHasAvailability(userId, startISO, durationMins) {
  const start = new Date(startISO);
  const end = addMinutes(start, durationMins);
  const dayOfWeek = start.getUTCDay();
  const avResult = await db.find(tables.availability, `(user_id,eq,${userId})~and(day_of_week,eq,${dayOfWeek})`);
  const avRows = avResult.list || [];
  for (const av of avRows) {
    const [sh, sm] = av.start_time.split(':').map(Number);
    const [eh, em] = av.end_time.split(':').map(Number);
    const winStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), sh, sm));
    const winEnd   = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), eh, em));
    if (start >= winStart && end <= winEnd) return true;
  }
  return false;
}

export default async function teamBookingPageRoutes(fastify) {

  // Public booking page
  fastify.get('/book/:org_slug/:team_slug/:event_slug', {
    schema: {
      tags: ['Public'],
      summary: 'Team booking page',
      description: 'Returns the HTML booking page for a team event type. Open in a browser — not an API endpoint.',
      params: { type: 'object', properties: { org_slug: { type: 'string' }, team_slug: { type: 'string' }, event_slug: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { org_slug, team_slug, event_slug } = req.params;
    return reply.type('text/html').send(buildTeamPage(org_slug, team_slug, event_slug));
  });

  // Create team booking
  fastify.post('/v1/book/:org_slug/:team_slug/:event_slug', {
    schema: {
      tags: ['Public'],
      summary: 'Create a team booking',
      description: 'Submit a booking for a team event type. A team member is auto-assigned based on the team\'s routing setting (`round_robin` or `random`). Returns booking confirmation including `cancel_url` and `assigned_to`.',
      params: { type: 'object', properties: { org_slug: { type: 'string' }, team_slug: { type: 'string' }, event_slug: { type: 'string' } } },
      body: {
        type: 'object', required: ['start_time', 'attendee_name', 'attendee_email'],
        properties: {
          start_time: { type: 'string', description: 'ISO 8601 datetime from the `/v1/slots` response' },
          attendee_name: { type: 'string' },
          attendee_email: { type: 'string', format: 'email' },
          attendee_timezone: { type: 'string', default: 'UTC' },
          notes: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { org_slug, team_slug, event_slug } = req.params;
    const { start_time, attendee_name, attendee_email, attendee_timezone = 'UTC', notes } = req.body || {};

    if (!start_time || !attendee_name || !attendee_email) {
      return reply.code(400).send({ error: 'start_time, attendee_name, attendee_email required' });
    }

    const orgResult = await db.find(tables.organizations, `(slug,eq,${org_slug})`);
    if (!orgResult.list?.length) return reply.code(404).send({ error: 'Org not found' });
    const org = orgResult.list[0];

    const teamResult = await db.find(tables.teams, `(org_id,eq,${org.Id})~and(slug,eq,${team_slug})`);
    if (!teamResult.list?.length) return reply.code(404).send({ error: 'Team not found' });
    const team = teamResult.list[0];

    const etResult = await db.find(tables.team_event_types, `(team_id,eq,${team.Id})~and(slug,eq,${event_slug})`);
    if (!etResult.list?.length) return reply.code(404).send({ error: 'Event type not found' });
    const eventType = etResult.list[0];

    const tmResult = await db.find(tables.team_members, `(team_id,eq,${team.Id})~and(active,eq,true)`);
    let members = tmResult.list || [];
    if (!members.length) return reply.code(409).send({ error: 'No team members available at that time' });

    let assignedMember = null;
    if (team.routing === 'round_robin') {
      const lastIdx = parseInt(team.last_assigned_index) || 0;
      for (let i = 0; i < members.length; i++) {
        const idx = (lastIdx + 1 + i) % members.length;
        const m = members[idx];
        if (await memberHasAvailability(m.user_id, start_time, eventType.duration_minutes)) {
          assignedMember = m;
          await db.update(tables.teams, team.Id, { last_assigned_index: idx });
          break;
        }
      }
    } else {
      const shuffled = [...members].sort(() => Math.random() - 0.5);
      for (const m of shuffled) {
        if (await memberHasAvailability(m.user_id, start_time, eventType.duration_minutes)) {
          assignedMember = m; break;
        }
      }
    }

    if (!assignedMember) return reply.code(409).send({ error: 'No team members available at that time' });

    const start = parseISO(start_time);
    const end = addMinutes(start, eventType.duration_minutes);
    const uid = nanoid(12);
    const cancel_token = nanoid(24);
    const reschedule_token = nanoid(24);

    await db.create(tables.bookings, {
      uid, event_type_id: String(eventType.Id), user_id: String(assignedMember.user_id),
      attendee_name, attendee_email, attendee_timezone,
      start_time: start.toISOString(), end_time: end.toISOString(),
      status: 'confirmed', notes: notes || '',
      cancel_token, reschedule_token, created_at: new Date().toISOString(),
    });

    const BASE_DOMAIN = process.env.BASE_DOMAIN || 'schedkit.net';
    const cancelUrl = `https://${BASE_DOMAIN}/v1/cancel/${cancel_token}`;
    const rescheduleUrl = `https://${BASE_DOMAIN}/v1/reschedule/${reschedule_token}`;
    const assignedUser = await db.get(tables.users, assignedMember.user_id);

    await sendBookingConfirmation({
      attendee_name, attendee_email,
      host_name: team.name, host_email: assignedUser?.email,
      event_title: eventType.title,
      start_time: start.toISOString(), timezone: attendee_timezone,
      cancel_url: cancelUrl, reschedule_url: rescheduleUrl,
    });

    if (assignedUser?.email) {
      try {
        await sendBookingConfirmation({
          attendee_name, attendee_email: assignedUser.email,
          host_name: team.name, host_email: assignedUser.email,
          event_title: `[Team: ${team.name}] ${eventType.title}`,
          start_time: start.toISOString(), timezone: attendee_timezone,
          cancel_url: cancelUrl, reschedule_url: rescheduleUrl,
        });
      } catch (e) { fastify.log.warn('Team member notification failed:', e.message); }
    }

    return reply.code(201).send({
      uid, status: 'confirmed',
      start_time: start.toISOString(), end_time: end.toISOString(),
      assigned_to: assignedUser?.name || assignedUser?.email,
      cancel_url: `/v1/cancel/${cancel_token}`,
      reschedule_url: `/v1/reschedule/${reschedule_token}`,
    });
  });
}

function buildTeamPage(orgSlug, teamSlug, eventSlug) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Book a Meeting</title>
<link rel="manifest" href="/manifest.json">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="SchedKit">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #111112;
  --card: #1a1a1f;
  --surface: #222228;
  --surface2: #2a2a32;
  --border: rgba(255,255,255,0.07);
  --border2: rgba(255,255,255,0.12);
  --accent: #DFFF00;
  --accent-fg: #0d0d0d;
  --accent-dim: rgba(223,255,0,0.10);
  --text: #f0f0f2;
  --text2: #8888a0;
  --muted: #4a4a5e;
  --day-avail: #2a2a32;
  --day-avail-hover: #35353f;
  --error: #ff5f5f;
  --font-sans: 'Space Grotesk', system-ui, sans-serif;
  --font-mono: 'Fira Code', monospace;
  --r: 12px;
  --r-day: 10px;
}
[data-lights="on"] {
  --bg: #eeecea;
  --card: #f8f7f4;
  --surface: #eeede9;
  --surface2: #e4e3de;
  --border: rgba(0,0,0,0.07);
  --border2: rgba(0,0,0,0.13);
  --accent: #3a4500;
  --accent-fg: #f8f7f4;
  --accent-dim: rgba(58,69,0,0.09);
  --text: #111110;
  --text2: #55554a;
  --muted: #99997a;
  --day-avail: #e4e3de;
  --day-avail-hover: #d8d7d0;
  --error: #c0392b;
}

html, body {
  min-height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.5;
}

.page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
}

.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 18px;
  width: 100%;
  max-width: 920px;
  overflow: hidden;
  box-shadow: 0 8px 48px rgba(0,0,0,0.35);
  display: flex;
  flex-direction: column;
}

.card-body {
  display: flex;
  min-height: 480px;
}

.info-panel {
  width: 240px;
  flex-shrink: 0;
  padding: 32px 28px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}
.info-avatar {
  width: 44px; height: 44px;
  border-radius: 50%;
  background: var(--surface2);
  border: 1px solid var(--border2);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px;
  font-family: 'Fira Code', 'Courier New', monospace;
  color: var(--accent);
  letter-spacing: 0.05em;
  margin-bottom: 12px;
  flex-shrink: 0;
}
.info-name { font-size: 13px; color: var(--text2); margin-bottom: 4px; font-weight: 500; }
.info-title { font-size: 20px; font-weight: 700; color: var(--text); line-height: 1.2; margin-bottom: 16px; }
.info-meta { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
.meta-row { display: flex; align-items: center; gap: 9px; font-size: 13px; color: var(--text2); }
.meta-icon { font-family: 'Fira Code', 'Courier New', monospace; color: var(--accent); letter-spacing: 0.04em; font-size: 14px; flex-shrink: 0; opacity: 0.7; }
.info-desc { font-size: 12px; color: var(--text2); line-height: 1.65; border-top: 1px solid var(--border); padding-top: 14px; margin-top: 4px; }
.info-spacer { flex: 1; }
.info-footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border); }
.lights-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: 20px;
  border: 1px solid var(--border2); background: transparent;
  color: var(--text2); font-family: var(--font-mono);
  font-size: 10px; letter-spacing: 0.07em;
  cursor: pointer; transition: all .18s;
}
.lights-btn:hover { border-color: var(--accent); color: var(--accent); }

.picker-area { flex: 1; display: flex; overflow: hidden; position: relative; }

.cal-panel { flex: 1; padding: 32px 28px; min-width: 0; }
.cal-heading { font-size: 11px; font-family: var(--font-mono); color: var(--muted); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 20px; }
.cal-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.cal-nav-btn {
  background: none; border: 1px solid var(--border2); color: var(--text);
  width: 34px; height: 34px; border-radius: 8px; cursor: pointer; font-size: 17px;
  display: flex; align-items: center; justify-content: center; transition: all 0.15s;
}
.cal-nav-btn:hover { border-color: var(--accent); color: var(--accent); }
.cal-month { font-weight: 700; font-size: 17px; }
.cal-month span { color: var(--text2); font-weight: 400; margin-left: 6px; }
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; }
.cal-dow { font-size: 11px; color: var(--text2); text-align: center; padding: 0 0 8px; font-family: var(--font-sans); font-weight: 500; }
.cal-day {
  aspect-ratio: 1;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 500;
  border-radius: var(--r-day);
  cursor: pointer;
  transition: background 0.12s, color 0.12s, transform 0.1s;
  border: none; background: transparent;
  position: relative; color: var(--text2); user-select: none;
}
.cal-day.empty { cursor: default; }
.cal-day.disabled { color: var(--muted); opacity: 0.35; cursor: default; }
.cal-day.today { color: var(--text); font-weight: 700; }
.cal-day.today::after { content: ''; position: absolute; bottom: 5px; left: 50%; transform: translateX(-50%); width: 3px; height: 3px; border-radius: 50%; background: var(--accent); }
.cal-day.has-slots { background: var(--day-avail); color: var(--text); }
.cal-day.has-slots:hover:not(.selected):not(.disabled) { background: var(--day-avail-hover); transform: scale(1.08); }
.cal-day.selected { background: var(--accent) !important; color: var(--accent-fg) !important; font-weight: 700; transform: scale(1.08); }
.cal-day.selected::after { display: none; }

.tz-row { margin-top: 20px; display: flex; align-items: center; gap: 8px; }
.tz-globe { font-size: 11px; font-family: 'Fira Code', monospace; color: var(--accent); letter-spacing: 0.04em; flex-shrink: 0; }
.tz-select {
  background: transparent; border: none; color: var(--text2);
  font-family: var(--font-sans); font-size: 13px;
  cursor: pointer; padding: 0; flex: 1;
  appearance: none; -webkit-appearance: none;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px;
}
.tz-select:focus { outline: none; }
.tz-chevron { font-size: 10px; color: var(--text2); }

.slots-panel {
  width: 0; overflow: hidden;
  border-left: 1px solid transparent;
  transition: width 0.32s cubic-bezier(0.4,0,0.2,1), border-color 0.32s, opacity 0.25s;
  opacity: 0; flex-shrink: 0;
}
.slots-panel.open { width: 240px; border-left-color: var(--border); opacity: 1; }
.slots-inner { width: 240px; padding: 32px 20px; height: 100%; overflow-y: auto; display: flex; flex-direction: column; }
.slots-date-label { font-size: 14px; font-weight: 700; margin-bottom: 4px; }
.slots-count { font-size: 11px; color: var(--text2); font-family: var(--font-mono); margin-bottom: 18px; }
.slots-list { display: flex; flex-direction: column; gap: 8px; }
.slot-btn {
  background: var(--surface); border: 1px solid var(--border2); color: var(--text);
  padding: 12px 16px; border-radius: 10px; cursor: pointer;
  font-family: var(--font-sans); font-size: 14px; font-weight: 600;
  transition: all 0.15s; text-align: center; white-space: nowrap;
  animation: slotIn 0.25s ease both;
}
.slot-btn:hover { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); transform: translateX(3px); }
@keyframes slotIn { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: translateX(0); } }
.slots-empty, .slots-loading { font-size: 12px; color: var(--text2); font-family: var(--font-mono); padding: 8px 0; }
.slots-inner::-webkit-scrollbar { width: 3px; }
.slots-inner::-webkit-scrollbar-thumb { background: var(--surface2); border-radius: 2px; }

.form-pane { padding: 32px 36px; border-top: 1px solid var(--border); }
.form-back {
  display: inline-flex; align-items: center; gap: 6px;
  background: none; border: none; color: var(--text2);
  font-family: var(--font-sans); font-size: 13px; cursor: pointer; padding: 0; margin-bottom: 24px;
  transition: color 0.15s;
}
.form-back:hover { color: var(--accent); }
.selected-slot-card {
  background: var(--surface); border: 1px solid var(--border2);
  border-radius: var(--r); padding: 14px 18px; margin-bottom: 28px;
  display: flex; gap: 14px; align-items: center;
}
.selected-slot-time { font-size: 17px; font-weight: 700; }
.selected-slot-meta { font-size: 12px; color: var(--text2); margin-top: 2px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.field { margin-bottom: 16px; }
.field-lbl { font-size: 11px; font-family: var(--font-mono); color: var(--text2); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
.field input, .field textarea {
  background: var(--surface); border: 1px solid var(--border2); color: var(--text);
  padding: 11px 14px; border-radius: 10px; font-family: var(--font-sans); font-size: 14px; width: 100%;
  transition: border-color 0.15s;
}
.field input:focus, .field textarea:focus { outline: none; border-color: var(--accent); }
.field textarea { resize: vertical; min-height: 88px; }
.btn-confirm {
  background: var(--accent); color: var(--accent-fg);
  border: none; padding: 14px 28px; border-radius: var(--r);
  font-weight: 700; font-size: 15px; cursor: pointer; width: 100%;
  margin-top: 6px; font-family: var(--font-sans);
  transition: opacity 0.15s, transform 0.1s; letter-spacing: 0.01em;
}
.btn-confirm:hover:not(:disabled) { opacity: 0.88; }
.btn-confirm:active:not(:disabled) { transform: scale(0.99); }
.btn-confirm:disabled { opacity: 0.35; cursor: default; }
.error-msg { background: rgba(255,95,95,0.08); border: 1px solid var(--error); color: var(--error); padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }

.confirm-pane { padding: 48px 36px; display: flex; flex-direction: column; align-items: flex-start; }
.confirm-check { width: 54px; height: 54px; border-radius: 50%; background: var(--accent); color: var(--accent-fg); display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 700; margin-bottom: 18px; }
.confirm-headline { font-size: 26px; font-weight: 700; margin-bottom: 6px; }
.confirm-sub { font-size: 14px; color: var(--text2); margin-bottom: 24px; }
.confirm-detail { background: var(--surface); border: 1px solid var(--border2); border-radius: var(--r); overflow: hidden; width: 100%; max-width: 480px; margin-bottom: 16px; }
.confirm-row { display: flex; gap: 12px; align-items: flex-start; padding: 13px 16px; border-bottom: 1px solid var(--border); }
.confirm-row:last-child { border-bottom: none; }
.confirm-row-icon { font-size: 11px; font-family: 'Fira Code', monospace; color: var(--accent); letter-spacing: 0.04em; flex-shrink: 0; margin-top: 1px; }
.confirm-row-lbl { font-size: 10px; color: var(--text2); font-family: var(--font-mono); margin-bottom: 1px; }
.confirm-row-val { font-size: 13px; font-weight: 600; }
.confirm-uid { font-size: 11px; font-family: var(--font-mono); color: var(--muted); margin-top: 4px; }
.btn-cancel-bkg { background: none; border: none; color: var(--muted); font-size: 12px; font-family: var(--font-sans); cursor: pointer; text-decoration: underline; margin-top: 14px; transition: color 0.15s; }
.btn-cancel-bkg:hover { color: var(--error); }

.card-footer { padding: 10px 24px; border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: center; }
.brand-link { font-size: 11px; font-family: var(--font-mono); color: var(--muted); text-decoration: none; display: flex; align-items: center; gap: 6px; }
.brand-link:hover { color: var(--text2); }

@media (max-width: 720px) {
  .page { padding: 0; justify-content: flex-start; }
  .card { max-width: 100%; border-radius: 0; border-left: none; border-right: none; box-shadow: none; min-height: 100vh; }
  .card-body { flex-direction: column; }
  .info-panel { width: 100%; border-right: none; border-bottom: 1px solid var(--border); padding: 24px 20px 20px; flex-direction: row; flex-wrap: wrap; align-items: flex-start; }
  .info-avatar { display: none; }
  .info-name { width: 100%; margin-bottom: 2px; }
  .info-title { width: 100%; font-size: 18px; margin-bottom: 10px; }
  .info-meta { flex-direction: row; flex-wrap: wrap; gap: 10px 16px; }
  .info-desc { width: 100%; }
  .info-spacer { display: none; }
  .info-footer { display: none; }
  .picker-area { flex-direction: column; }
  .cal-panel { padding: 20px 16px; }
  .slots-panel { width: 100% !important; border-left: none !important; border-top: 1px solid var(--border); opacity: 1 !important; height: auto; }
  .slots-panel:not(.open) { display: none; }
  .slots-inner { width: 100%; padding: 16px; }
  .slots-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .slot-btn { animation: none; }
  .form-pane { padding: 20px 16px; }
  .form-grid { grid-template-columns: 1fr; }
  .confirm-pane { padding: 24px 16px; }
  .confirm-detail { max-width: 100%; }
  .mobile-lights { display: flex !important; }
}
@media (min-width: 721px) { .mobile-lights { display: none !important; } }

#lightsFlicker { position: fixed; inset: 0; z-index: 9999; pointer-events: none; }
</style>
</head>
<body>
<div id="lightsFlicker" style="background:rgba(255,255,230,0)"></div>
<div class="page">
  <div class="card" id="card">

    <div class="card-body" id="card-body">

      <!-- INFO PANEL -->
      <div class="info-panel">
        <div class="info-avatar" id="info-avatar">[▶]</div>
        <div class="info-name" id="info-name">Loading...</div>
        <div class="info-title" id="info-title"></div>
        <div class="info-meta" id="info-meta"></div>
        <div class="info-desc" id="info-desc" style="display:none"></div>
        <div class="info-spacer"></div>
        <div class="info-footer">
          <button class="lights-btn" id="lightsBtn">
            <span>[◑]</span><span id="lightsBtnLabel">LIGHTS ON</span>
          </button>
        </div>
      </div>

      <!-- PICKER: calendar + sliding slots -->
      <div class="picker-area" id="picker-area">
        <div class="cal-panel">
          <div class="cal-heading">Select a date</div>
          <div class="cal-nav">
            <button class="cal-nav-btn" id="prev-month">&#8249;</button>
            <div class="cal-month" id="cal-month-label"></div>
            <button class="cal-nav-btn" id="next-month">&#8250;</button>
          </div>
          <div class="cal-grid" id="cal-grid"></div>
          <div class="tz-row">
            <span class="tz-globe">[◷]</span>
            <select class="tz-select" id="tz-select"></select>
            <span class="tz-chevron">▾</span>
          </div>
        </div>

        <div class="slots-panel" id="slots-panel">
          <div class="slots-inner">
            <div class="slots-date-label" id="slots-date-label"></div>
            <div class="slots-count" id="slots-count"></div>
            <div class="slots-list" id="slots-list"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- FORM PANE -->
    <div id="form-pane" class="form-pane" style="display:none">
      <button class="form-back" id="btn-back">← Back</button>
      <div class="selected-slot-card">
        <span style="font-size:22px">[◷]</span>
        <div>
          <div class="selected-slot-time" id="selected-slot-time"></div>
          <div class="selected-slot-meta" id="selected-slot-meta"></div>
        </div>
      </div>
      <div id="form-error" class="error-msg" style="display:none"></div>
      <div class="form-grid">
        <div class="field">
          <div class="field-lbl">Full Name *</div>
          <input type="text" id="f-name" placeholder="Jane Smith" autocomplete="name">
        </div>
        <div class="field">
          <div class="field-lbl">Email *</div>
          <input type="email" id="f-email" placeholder="jane@example.com" autocomplete="email">
        </div>
      </div>
      <div class="field">
        <div class="field-lbl">Notes (optional)</div>
        <textarea id="f-notes" placeholder="Anything to share beforehand..."></textarea>
      </div>
      <button class="btn-confirm" id="btn-confirm">Confirm Booking</button>
    </div>

    <!-- CONFIRMATION PANE -->
    <div id="confirm-pane" style="display:none" class="confirm-pane">
      <div class="confirm-check" id="confirm-icon">✓</div>
      <div class="confirm-headline" id="confirm-headline">You&#39;re booked!</div>
      <div class="confirm-sub" id="confirm-sub">Confirmation sent to <strong id="confirm-email"></strong></div>
      <div class="confirm-detail" id="confirm-detail"></div>
      <div class="confirm-uid" id="confirm-uid"></div>
      <button class="btn-cancel-bkg" id="btn-cancel-bkg" style="display:none">Cancel this booking</button>
      <a href="/dashboard" style="display:inline-block;margin-top:20px;background:var(--accent);color:#0a0a0b;text-decoration:none;padding:12px 28px;border-radius:8px;font-family:var(--font-mono);font-size:13px;font-weight:700;letter-spacing:0.05em;text-align:center;width:100%;box-sizing:border-box;">DONE →</a>
    </div>

    <!-- FOOTER -->
    <div class="card-footer">
      <div style="display:flex;align-items:center;gap:16px;">
        <a class="brand-link" href="https://schedkit.net" target="_blank">
          <svg width="14" height="14" viewBox="0 0 512 512"><rect width="512" height="512" rx="80" fill="#DFFF00"/><line x1="128" y1="96" x2="208" y2="416" stroke="#0A0A0B" stroke-width="72" stroke-linecap="round"/><line x1="272" y1="96" x2="352" y2="416" stroke="#0A0A0B" stroke-width="72" stroke-linecap="round"/></svg>
          schedkit.net
        </a>
        <button class="lights-btn mobile-lights" id="lightsBtnMobile" style="display:none">
          <span>[◑]</span><span id="lightsBtnLabelMobile">LIGHTS ON</span>
        </button>
      </div>
    </div>

  </div>
</div>

<script>
(async () => {
  const ORG_SLUG   = ${JSON.stringify(orgSlug)};
  const TEAM_SLUG  = ${JSON.stringify(teamSlug)};
  const EVENT_SLUG = ${JSON.stringify(eventSlug)};

  let eventType = null, selectedDate = null, selectedSlot = null;
  let currentYear, currentMonth;
  let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let availableDates = new Set();
  let cancelUrl = null;

  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();

  await loadEventType();
  populateTimezones();
  renderCalendar();
  preloadMonth();

  async function loadEventType() {
    try {
      const res = await fetch(\`/v1/slots/\${ORG_SLUG}/\${TEAM_SLUG}/\${EVENT_SLUG}?date=\${fmtDate(now)}&timezone=\${encodeURIComponent(timezone)}\`);
      const data = await res.json();
      if (data.event_type) {
        eventType = data.event_type;
        const locIcon = { video:'[▶]', phone:'[~]', in_person:'[+]', other:'[◆]' }[eventType.location_type] || '[◷]';
        const locLabel = eventType.location || ({ video:'Video call', phone:'Phone call', in_person:'In person' }[eventType.location_type] || 'Meeting');
        document.getElementById('info-avatar').textContent = '[▶]';
        document.getElementById('info-name').textContent = TEAM_SLUG;
        document.getElementById('info-title').textContent = eventType.title;
        document.getElementById('info-meta').innerHTML = \`
          <div class="meta-row"><span class="meta-icon">⏱</span>\${eventType.duration_minutes} min</div>
          <div class="meta-row"><span class="meta-icon">\${locIcon}</span>\${locLabel}</div>
          <div class="meta-row"><span class="meta-icon">[▶]</span>Team booking</div>
        \`;
        document.title = 'Book: ' + eventType.title;
        if (eventType.description) { const d = document.getElementById('info-desc'); d.textContent = eventType.description; d.style.display = ''; }
      }
    } catch(e) { document.getElementById('info-name').textContent = 'Could not load event'; }
  }

  function populateTimezones() {
    const sel = document.getElementById('tz-select');
    const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [
      'America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
      'America/Phoenix','Europe/London','Europe/Paris','Europe/Berlin',
      'Asia/Tokyo','Asia/Singapore','Australia/Sydney','UTC'
    ];
    zones.forEach(z => { const o = document.createElement('option'); o.value = z; o.textContent = z; if (z === timezone) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', async () => { timezone = sel.value; availableDates.clear(); await preloadMonth(); renderCalendar(); if (selectedDate) loadSlots(selectedDate); });
  }

  function fmtDate(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }

  async function preloadMonth() {
    const year = currentYear, month = currentMonth;
    const daysInMonth = new Date(year, month+1, 0).getDate();
    const todayStr = fmtDate(now);
    const fetches = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = \`\${year}-\${String(month+1).padStart(2,'0')}-\${String(d).padStart(2,'0')}\`;
      if (ds < todayStr) continue;
      fetches.push(
        fetch(\`/v1/slots/\${ORG_SLUG}/\${TEAM_SLUG}/\${EVENT_SLUG}?date=\${ds}&timezone=\${encodeURIComponent(timezone)}\`)
          .then(r => r.json())
          .then(data => { if (data.slots?.length) availableDates.add(ds); })
          .catch(() => {})
      );
    }
    await Promise.all(fetches);
    renderCalendar();
  }

  function renderCalendar() {
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const monthEl = document.getElementById('cal-month-label');
    monthEl.innerHTML = \`<strong>\${MONTHS[currentMonth]}</strong> <span>\${currentYear}</span>\`;
    const grid = document.getElementById('cal-grid');
    grid.innerHTML = '';
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => { const el = document.createElement('div'); el.className = 'cal-dow'; el.textContent = d; grid.appendChild(el); });
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth+1, 0).getDate();
    const todayStr = fmtDate(now);
    for (let i = 0; i < firstDay; i++) { const el = document.createElement('div'); el.className = 'cal-day empty'; grid.appendChild(el); }
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = \`\${currentYear}-\${String(currentMonth+1).padStart(2,'0')}-\${String(d).padStart(2,'0')}\`;
      const el = document.createElement('div'); el.className = 'cal-day'; el.textContent = d;
      if (ds < todayStr) el.classList.add('disabled');
      else {
        if (ds === todayStr) el.classList.add('today');
        if (availableDates.has(ds)) el.classList.add('has-slots');
        if (ds === selectedDate) el.classList.add('selected');
        el.addEventListener('click', () => selectDate(ds));
      }
      grid.appendChild(el);
    }
  }

  document.getElementById('prev-month').addEventListener('click', async () => { currentMonth--; if (currentMonth < 0) { currentMonth = 11; currentYear--; } availableDates.clear(); renderCalendar(); await preloadMonth(); });
  document.getElementById('next-month').addEventListener('click', async () => { currentMonth++; if (currentMonth > 11) { currentMonth = 0; currentYear++; } availableDates.clear(); renderCalendar(); await preloadMonth(); });

  async function selectDate(ds) { selectedDate = ds; selectedSlot = null; renderCalendar(); loadSlots(ds); }

  async function loadSlots(ds) {
    const panel = document.getElementById('slots-panel');
    const list = document.getElementById('slots-list');
    const countEl = document.getElementById('slots-count');
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const [y,m,d] = ds.split('-').map(Number);
    const dow = new Date(y, m-1, d).getDay();
    document.getElementById('slots-date-label').textContent = \`\${DAYS[dow]}, \${MONTHS[m-1]} \${d}\`;
    list.innerHTML = '<div class="slots-loading">Loading...</div>';
    countEl.textContent = '';
    panel.classList.add('open');
    try {
      const res = await fetch(\`/v1/slots/\${ORG_SLUG}/\${TEAM_SLUG}/\${EVENT_SLUG}?date=\${ds}&timezone=\${encodeURIComponent(timezone)}\`);
      const data = await res.json();
      list.innerHTML = '';
      if (!data.slots?.length) { list.innerHTML = '<div class="slots-empty">No slots available.</div>'; countEl.textContent = '0 available'; return; }
      countEl.textContent = \`\${data.slots.length} time\${data.slots.length===1?'':'s'} available\`;
      data.slots.forEach((slot, i) => {
        const btn = document.createElement('button'); btn.className = 'slot-btn';
        const t = new Date(slot.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: timezone });
        btn.textContent = t;
        btn.style.animationDelay = \`\${i * 35}ms\`;
        btn.addEventListener('click', () => selectSlot(slot, t, ds));
        list.appendChild(btn);
      });
    } catch(e) { list.innerHTML = '<div class="slots-empty">Error loading slots.</div>'; }
  }

  function selectSlot(slot, timeStr, ds) {
    selectedSlot = slot;
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const [y,m,d] = ds.split('-').map(Number);
    document.getElementById('selected-slot-time').textContent = timeStr;
    document.getElementById('selected-slot-meta').textContent = \`\${MONTHS[m-1]} \${d}, \${y} · \${timezone}\`;
    document.getElementById('card-body').style.display = 'none';
    document.getElementById('form-pane').style.display = '';
    document.getElementById('confirm-pane').style.display = 'none';
  }

  document.getElementById('btn-back').addEventListener('click', () => {
    document.getElementById('card-body').style.display = '';
    document.getElementById('form-pane').style.display = 'none';
    document.getElementById('confirm-pane').style.display = 'none';
  });

  document.getElementById('btn-confirm').addEventListener('click', async () => {
    const nameVal  = document.getElementById('f-name').value.trim();
    const emailVal = document.getElementById('f-email').value.trim();
    const notes    = document.getElementById('f-notes').value.trim();
    if (!nameVal || !emailVal) { showError('Name and email are required.'); return; }
    if (!/^[^@]+@[^@]+\\.[^@]+$/.test(emailVal)) { showError('Please enter a valid email.'); return; }
    document.getElementById('form-error').style.display = 'none';
    const btn = document.getElementById('btn-confirm'); btn.disabled = true; btn.textContent = 'Booking...';
    try {
      const res = await fetch(\`/v1/book/\${ORG_SLUG}/\${TEAM_SLUG}/\${EVENT_SLUG}\`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_time: selectedSlot.start, attendee_name: nameVal, attendee_email: emailVal, attendee_timezone: timezone, notes }),
      });
      const data = await res.json();
      if (!res.ok) { showError(data.error || 'Failed. Please try again.'); btn.disabled = false; btn.textContent = 'Confirm Booking'; return; }

      const startLocal = new Date(data.start_time).toLocaleString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: timezone });
      document.getElementById('confirm-email').textContent = emailVal;
      document.getElementById('confirm-detail').innerHTML =
        '<div class="confirm-row"><div class="confirm-row-icon">[◷]</div><div><div class="confirm-row-lbl">Date &amp; Time</div><div class="confirm-row-val">' + startLocal + '</div></div></div>' +
        '<div class="confirm-row"><div class="confirm-row-icon">[◷]</div><div><div class="confirm-row-lbl">Timezone</div><div class="confirm-row-val">' + timezone + '</div></div></div>' +
        '<div class="confirm-row"><div class="confirm-row-icon">[▶]</div><div><div class="confirm-row-lbl">Team</div><div class="confirm-row-val">' + (data.assigned_to ? 'With ' + data.assigned_to : TEAM_SLUG) + '</div></div></div>';
      document.getElementById('confirm-uid').textContent = 'Booking ID: ' + data.uid;

      if (data.status === 'pending') {
        document.getElementById('confirm-icon').textContent = '⏳';
        document.getElementById('confirm-headline').textContent = 'Request received!';
        document.getElementById('confirm-sub').innerHTML = 'Your request is awaiting confirmation. You will be emailed at <strong>' + emailVal + '</strong> once confirmed.';
      } else {
        cancelUrl = data.cancel_url;
        document.getElementById('btn-cancel-bkg').style.display = '';
      }

      document.getElementById('card-body').style.display = 'none';
      document.getElementById('form-pane').style.display = 'none';
      document.getElementById('confirm-pane').style.display = '';

      // Notify parent frame (embed SDK)
      try {
        window.parent.postMessage({
          type: 'schedkit:booked',
          data: {
            uid: data.uid,
            start_time: data.start_time,
            attendee_name: nameVal,
            attendee_email: emailVal,
            attendee_timezone: timezone,
            status: data.status || 'confirmed',
            requires_confirmation: data.status === 'pending',
          }
        }, '*');
      } catch(_) {}
    } catch(e) { showError('Network error. Please try again.'); btn.disabled = false; btn.textContent = 'Confirm Booking'; }
  });

  document.getElementById('btn-cancel-bkg').addEventListener('click', async () => {
    if (!cancelUrl || !confirm('Cancel this booking?')) return;
    try {
      await fetch(cancelUrl, { method: 'POST' });
      document.getElementById('confirm-pane').innerHTML = '<div style="padding:48px 36px;color:var(--text2);font-family:var(--font-mono);font-size:13px">Booking cancelled.</div>';
    } catch(e) {}
  });

  function showError(msg) { const el = document.getElementById('form-error'); el.textContent = msg; el.style.display = 'block'; }

  // ── Lights ──
  (function() {
    const flicker = document.getElementById('lightsFlicker');
    let lights = localStorage.getItem('p7-lights') === '1' ||
      (localStorage.getItem('p7-lights') === null && window.matchMedia?.('(prefers-color-scheme: light)').matches);
    function apply(on) {
      document.documentElement.setAttribute('data-lights', on ? 'on' : 'off');
      ['lightsBtnLabel','lightsBtnLabelMobile'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = on ? 'LIGHTS OFF' : 'LIGHTS ON'; });
    }
    function flickerOn(cb) {
      let i = 0, fl = [80,60,100,50,120,40,200];
      function s() { flicker.style.background = i%2===0?'rgba(255,255,230,0.18)':'rgba(255,255,230,0)'; i++; if(i<fl.length)setTimeout(s,fl[i-1]);else{flicker.style.background='rgba(255,255,230,0)';cb();} }
      s();
    }
    apply(lights);
    ['lightsBtn','lightsBtnMobile'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', () => {
        if (!lights) { flickerOn(() => { lights=true; localStorage.setItem('p7-lights','1'); apply(true); }); }
        else { lights=false; localStorage.setItem('p7-lights','0'); apply(false); }
      });
    });
  })();
})();
</script>
</body>
</html>`;
}
