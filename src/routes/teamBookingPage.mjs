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

  // Get day of week (0-6) in UTC (simplified; slot generation uses UTC offsets)
  const dayOfWeek = start.getUTCDay();

  const avResult = await db.find(
    tables.availability,
    `(user_id,eq,${userId})~and(day_of_week,eq,${dayOfWeek})`
  );
  const avRows = avResult.list || [];

  for (const av of avRows) {
    const [sh, sm] = av.start_time.split(':').map(Number);
    const [eh, em] = av.end_time.split(':').map(Number);
    // Build window for that day in UTC
    const winStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), sh, sm));
    const winEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), eh, em));
    if (start >= winStart && end <= winEnd) return true;
  }
  return false;
}

export default async function teamBookingPageRoutes(fastify) {

  // Public booking page
  fastify.get('/book/:org_slug/:team_slug/:event_slug', async (req, reply) => {
    const { org_slug, team_slug, event_slug } = req.params;
    return reply.type('text/html').send(buildTeamPage(org_slug, team_slug, event_slug));
  });

  // Create team booking
  fastify.post('/v1/book/:org_slug/:team_slug/:event_slug', async (req, reply) => {
    const { org_slug, team_slug, event_slug } = req.params;
    const { start_time, attendee_name, attendee_email, attendee_timezone = 'UTC', notes } = req.body || {};

    if (!start_time || !attendee_name || !attendee_email) {
      return reply.code(400).send({ error: 'start_time, attendee_name, attendee_email required' });
    }

    // Resolve org → team → event type
    const orgResult = await db.find(tables.organizations, `(slug,eq,${org_slug})`);
    if (!orgResult.list?.length) return reply.code(404).send({ error: 'Org not found' });
    const org = orgResult.list[0];

    const teamResult = await db.find(tables.teams, `(org_id,eq,${org.Id})~and(slug,eq,${team_slug})`);
    if (!teamResult.list?.length) return reply.code(404).send({ error: 'Team not found' });
    const team = teamResult.list[0];

    const etResult = await db.find(tables.team_event_types, `(team_id,eq,${team.Id})~and(slug,eq,${event_slug})`);
    if (!etResult.list?.length) return reply.code(404).send({ error: 'Event type not found' });
    const eventType = etResult.list[0];

    // Get active team members
    const tmResult = await db.find(tables.team_members, `(team_id,eq,${team.Id})~and(active,eq,true)`);
    let members = tmResult.list || [];
    if (!members.length) return reply.code(409).send({ error: 'No team members available at that time' });

    // Routing
    let assignedMember = null;

    if (team.routing === 'round_robin') {
      const lastIdx = parseInt(team.last_assigned_index) || 0;
      // Try members starting from lastIdx+1 (circular)
      for (let i = 0; i < members.length; i++) {
        const idx = (lastIdx + 1 + i) % members.length;
        const m = members[idx];
        if (await memberHasAvailability(m.user_id, start_time, eventType.duration_minutes)) {
          assignedMember = m;
          // Update last_assigned_index
          await db.update(tables.teams, team.Id, { last_assigned_index: idx });
          break;
        }
      }
    } else {
      // random: shuffle then find first available
      const shuffled = [...members].sort(() => Math.random() - 0.5);
      for (const m of shuffled) {
        if (await memberHasAvailability(m.user_id, start_time, eventType.duration_minutes)) {
          assignedMember = m;
          break;
        }
      }
    }

    if (!assignedMember) {
      return reply.code(409).send({ error: 'No team members available at that time' });
    }

    const start = parseISO(start_time);
    const end = addMinutes(start, eventType.duration_minutes);

    // Create booking
    const uid = nanoid(12);
    const cancel_token = nanoid(24);
    const reschedule_token = nanoid(24);

    await db.create(tables.bookings, {
      uid,
      event_type_id: String(eventType.Id),
      user_id: String(assignedMember.user_id),
      attendee_name,
      attendee_email,
      attendee_timezone,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status: 'confirmed',
      notes: notes || '',
      cancel_token,
      reschedule_token,
      created_at: new Date().toISOString(),
    });

    const BASE_DOMAIN = process.env.BASE_DOMAIN || 'schedkit.net';
    const cancelUrl = `https://${BASE_DOMAIN}/v1/cancel/${cancel_token}`;
    const rescheduleUrl = `https://${BASE_DOMAIN}/v1/reschedule/${reschedule_token}`;

    // Get assigned member's user record for email
    const assignedUser = await db.get(tables.users, assignedMember.user_id);

    // Send confirmation to attendee
    await sendBookingConfirmation({
      attendee_name,
      attendee_email,
      host_name: team.name,
      host_email: assignedUser?.email,
      event_title: eventType.title,
      start_time: start.toISOString(),
      timezone: attendee_timezone,
      cancel_url: cancelUrl,
      reschedule_url: rescheduleUrl,
    });

    // Notify assigned team member
    if (assignedUser?.email) {
      try {
        await sendBookingConfirmation({
          attendee_name,
          attendee_email: assignedUser.email,
          host_name: team.name,
          host_email: assignedUser.email,
          event_title: `[Team: ${team.name}] ${eventType.title}`,
          start_time: start.toISOString(),
          timezone: attendee_timezone,
          cancel_url: cancelUrl,
          reschedule_url: rescheduleUrl,
        });
      } catch (e) {
        fastify.log.warn('Team member notification failed:', e.message);
      }
    }

    return reply.code(201).send({
      uid,
      status: 'confirmed',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0a0a0b; --surface: #111114; --surface2: #18181d;
  --border: #1e1e24; --border2: #2a2a33;
  --accent: #DFFF00; --accent-dim: rgba(223,255,0,0.08); --accent-hover: rgba(223,255,0,0.14);
  --text: #e8e8ea; --text2: #a0a0b0; --muted: #52526a;
  --error: #ff5f5f; --success: #00e5a0;
  --font-sans: 'Space Grotesk', system-ui, sans-serif;
  --font-mono: 'Fira Code', monospace;
  --r: 10px; --sidebar-w: 300px; --cal-w: 380px;
}
[data-lights="on"] {
  --bg: #f2f1ec; --surface: #e8e7e2; --surface2: #deded8;
  --border: rgba(0,0,0,0.08); --border2: rgba(0,0,0,0.14);
  --accent: #3d4700; --accent-dim: rgba(61,71,0,0.08); --accent-hover: rgba(61,71,0,0.14);
  --text: #111110; --text2: #4a4a40; --muted: #888870;
  --error: #c0392b; --success: #1a7a52;
}
html, body { height: 100%; background: var(--bg); color: var(--text); font-family: var(--font-sans); font-size: 14px; }
.layout { display: grid; grid-template-columns: var(--sidebar-w) 1px var(--cal-w) 1px 1fr; grid-template-rows: 100vh; height: 100vh; overflow: hidden; }
.divider { background: var(--border); height: 100%; }
.sidebar { display: flex; flex-direction: column; padding: 36px 32px; overflow-y: auto; }
.sidebar-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 40px; }
.sidebar-wordmark { font-family: var(--font-mono); font-size: 13px; color: var(--text2); letter-spacing: 0.05em; }
.sidebar-wordmark span { color: var(--muted); }
.host-avatar { width: 52px; height: 52px; border-radius: 50%; background: var(--surface2); border: 1px solid var(--border2); display: flex; align-items: center; justify-content: center; font-size: 22px; margin-bottom: 14px; }
.host-name { font-size: 13px; color: var(--text2); font-family: var(--font-mono); margin-bottom: 6px; }
.event-title { font-size: 22px; font-weight: 700; color: var(--text); line-height: 1.25; margin-bottom: 16px; }
.event-chips { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
.chip { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--text2); }
.chip-icon { width: 28px; height: 28px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; }
.event-desc { font-size: 13px; color: var(--text2); line-height: 1.65; border-top: 1px solid var(--border); padding-top: 16px; margin-top: 4px; }
.sidebar-footer { margin-top: auto; padding-top: 32px; }
.lights-btn { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 20px; border: 1px solid var(--border); background: transparent; color: var(--muted); font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; cursor: pointer; transition: all .2s; }
.lights-btn:hover { border-color: var(--accent); color: var(--accent); }
.cal-pane { display: flex; flex-direction: column; padding: 36px 32px; overflow-y: auto; }
.pane-heading { font-size: 11px; font-family: var(--font-mono); color: var(--muted); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 24px; }
.cal-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.cal-nav-btn { background: none; border: 1px solid var(--border); color: var(--text); width: 34px; height: 34px; border-radius: 8px; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
.cal-nav-btn:hover { border-color: var(--accent); color: var(--accent); }
.cal-month-label { font-weight: 600; font-size: 16px; }
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.cal-dow { font-size: 10px; color: var(--muted); text-align: center; padding: 0 0 10px; font-family: var(--font-mono); letter-spacing: 0.05em; }
.cal-day { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; font-size: 13px; border-radius: 8px; cursor: pointer; transition: background 0.1s, color 0.1s; border: 1px solid transparent; position: relative; font-weight: 500; }
.cal-day.empty { cursor: default; }
.cal-day.disabled { color: var(--muted); opacity: 0.3; cursor: default; }
.cal-day.today { border-color: var(--border2); }
.cal-day:hover:not(.disabled):not(.empty):not(.selected) { background: var(--accent-hover); border-color: var(--accent); color: var(--accent); }
.cal-day.selected { background: var(--accent); color: #0a0a0b; font-weight: 700; border-color: var(--accent); }
.cal-day.has-slots::after { content: ''; position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%); width: 3px; height: 3px; border-radius: 50%; background: var(--accent); }
.cal-day.selected::after { background: #0a0a0b; }
.tz-block { margin-top: 28px; }
.tz-label { font-size: 10px; font-family: var(--font-mono); color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
.tz-select { background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 9px 12px; border-radius: 8px; font-size: 13px; width: 100%; cursor: pointer; font-family: var(--font-sans); }
.tz-select:focus { outline: none; border-color: var(--accent); }
.right-pane { display: flex; flex-direction: column; padding: 36px 40px; overflow-y: auto; }
.slots-date { font-size: 17px; font-weight: 600; margin-bottom: 6px; }
.slots-count { font-size: 12px; color: var(--muted); font-family: var(--font-mono); margin-bottom: 24px; }
.slots-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.slot-btn { background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 13px 16px; border-radius: var(--r); cursor: pointer; font-family: var(--font-sans); font-size: 14px; font-weight: 600; transition: all 0.15s; display: flex; align-items: center; justify-content: center; }
.slot-btn:hover { border-color: var(--accent); background: var(--accent-hover); color: var(--accent); }
.slots-loading, .slots-empty { color: var(--muted); font-size: 13px; font-family: var(--font-mono); padding: 24px 0; }
.no-date-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; color: var(--muted); text-align: center; }
.no-date-icon { font-size: 48px; opacity: 0.3; }
.no-date-text { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.05em; }
.form-back { display: flex; align-items: center; gap: 6px; background: none; border: none; color: var(--text2); font-family: var(--font-sans); font-size: 13px; cursor: pointer; padding: 0; margin-bottom: 28px; transition: color 0.15s; }
.form-back:hover { color: var(--accent); }
.form-selected-slot { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); padding: 14px 16px; margin-bottom: 28px; display: flex; gap: 12px; align-items: center; }
.form-slot-time { font-weight: 600; font-size: 16px; }
.form-slot-meta { font-size: 12px; color: var(--text2); margin-top: 2px; }
.form-section-label { font-size: 11px; font-family: var(--font-mono); color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 16px; }
.field { margin-bottom: 16px; }
.field-label { font-size: 11px; font-family: var(--font-mono); color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
.field input, .field textarea, .field select { background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 11px 13px; border-radius: 8px; font-family: var(--font-sans); font-size: 14px; width: 100%; transition: border-color 0.15s; }
.field input:focus, .field textarea:focus, .field select:focus { outline: none; border-color: var(--accent); }
.field textarea { resize: vertical; min-height: 88px; }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.btn-confirm { background: var(--accent); color: #0a0a0b; border: none; padding: 14px 28px; border-radius: var(--r); font-weight: 700; font-size: 15px; cursor: pointer; width: 100%; margin-top: 8px; font-family: var(--font-sans); transition: opacity 0.15s; }
.btn-confirm:hover:not(:disabled) { opacity: 0.88; }
.btn-confirm:disabled { opacity: 0.35; cursor: default; }
.error-msg { background: rgba(255,95,95,0.08); border: 1px solid var(--error); color: var(--error); padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
.confirm-wrap { display: flex; flex-direction: column; justify-content: center; height: 100%; max-width: 400px; }
.confirm-check { width: 56px; height: 56px; border-radius: 50%; background: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 20px; color: #0a0a0b; }
.confirm-headline { font-size: 26px; font-weight: 700; margin-bottom: 8px; }
.confirm-sub { font-size: 14px; color: var(--text2); margin-bottom: 24px; }
.confirm-detail { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); overflow: hidden; margin-bottom: 20px; }
.confirm-detail-row { display: flex; gap: 12px; align-items: flex-start; padding: 14px 16px; border-bottom: 1px solid var(--border); }
.confirm-detail-row:last-child { border-bottom: none; }
.confirm-detail-icon { font-size: 15px; margin-top: 1px; flex-shrink: 0; }
.confirm-detail-label { font-size: 11px; color: var(--muted); font-family: var(--font-mono); margin-bottom: 2px; }
.confirm-detail-val { font-size: 14px; font-weight: 500; }
.confirm-uid { font-size: 11px; font-family: var(--font-mono); color: var(--muted); margin-top: 8px; }
.btn-cancel-booking { background: none; border: none; color: var(--muted); font-size: 12px; font-family: var(--font-sans); cursor: pointer; text-decoration: underline; margin-top: 12px; transition: color 0.15s; }
.btn-cancel-booking:hover { color: var(--error); }
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; grid-template-rows: auto; height: auto; overflow: visible; }
  .divider { display: none; }
  .sidebar { padding: 24px 20px; border-bottom: 1px solid var(--border); }
  .sidebar-footer { margin-top: 20px; padding-top: 20px; }
  .cal-pane { padding: 24px 20px; border-bottom: 1px solid var(--border); }
  .right-pane { padding: 24px 20px; min-height: 50vh; }
}
@media (max-width: 500px) {
  .slots-grid { grid-template-columns: 1fr; }
  .field-row { grid-template-columns: 1fr; }
}
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }
#lightsFlicker { position: fixed; inset: 0; z-index: 9999; pointer-events: none; }
</style>
</head>
<body>
<div id="lightsFlicker" style="background:rgba(255,255,230,0)"></div>
<div class="layout">
  <aside class="sidebar">
    <div class="sidebar-brand">
      <svg width="28" height="28" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" rx="96" fill="#0A0A0B"/><line x1="128" y1="96" x2="208" y2="416" stroke="#DFFF00" stroke-width="72" stroke-linecap="round"/><line x1="272" y1="96" x2="352" y2="416" stroke="#DFFF00" stroke-width="72" stroke-linecap="round"/></svg>
      <span class="sidebar-wordmark">sched<span>[kit]</span></span>
    </div>
    <div class="host-avatar" id="host-avatar">👥</div>
    <div class="host-name" id="host-name">Loading...</div>
    <div class="event-title" id="event-title"></div>
    <div class="event-chips" id="event-chips"></div>
    <div class="event-desc" id="event-desc" style="display:none"></div>
    <div class="sidebar-footer">
      <button class="lights-btn" id="lightsBtn"><span>🔦</span><span id="lightsBtnLabel">LIGHTS ON</span></button>
    </div>
  </aside>
  <div class="divider"></div>
  <section class="cal-pane">
    <div class="pane-heading">Select a date</div>
    <div class="cal-nav">
      <button class="cal-nav-btn" id="prev-month">&#8249;</button>
      <span class="cal-month-label" id="cal-month-label"></span>
      <button class="cal-nav-btn" id="next-month">&#8250;</button>
    </div>
    <div class="cal-grid" id="cal-grid"></div>
    <div class="tz-block">
      <div class="tz-label">Timezone</div>
      <select class="tz-select" id="tz-select"></select>
    </div>
  </section>
  <div class="divider"></div>
  <section class="right-pane" id="right-pane">
    <div id="state-empty" class="no-date-state">
      <div class="no-date-icon">📅</div>
      <div class="no-date-text">Pick a date to see available times</div>
    </div>
    <div id="state-slots" style="display:none">
      <div class="pane-heading">Available times</div>
      <div class="slots-date" id="slots-date"></div>
      <div class="slots-count" id="slots-count"></div>
      <div class="slots-grid" id="slots-grid"></div>
    </div>
    <div id="state-form" style="display:none">
      <button class="form-back" id="btn-back">← Back to times</button>
      <div class="form-selected-slot">
        <div style="font-size:20px">🕐</div>
        <div>
          <div class="form-slot-time" id="form-slot-time"></div>
          <div class="form-slot-meta" id="form-slot-meta"></div>
        </div>
      </div>
      <div class="form-section-label">Your details</div>
      <div id="form-error" class="error-msg" style="display:none"></div>
      <div class="field-row">
        <div class="field"><div class="field-label">Full Name *</div><input type="text" id="f-name" placeholder="Jane Smith" autocomplete="name"></div>
        <div class="field"><div class="field-label">Email *</div><input type="email" id="f-email" placeholder="jane@example.com" autocomplete="email"></div>
      </div>
      <div class="field"><div class="field-label">Notes (optional)</div><textarea id="f-notes" placeholder="Anything to share beforehand..."></textarea></div>
      <button class="btn-confirm" id="btn-confirm">Confirm Booking</button>
    </div>
    <div id="state-confirmed" style="display:none">
      <div class="confirm-wrap">
        <div class="confirm-check">✓</div>
        <div class="confirm-headline">You're booked!</div>
        <div class="confirm-sub">A confirmation has been sent to <strong id="confirm-email"></strong></div>
        <div class="confirm-detail" id="confirm-detail"></div>
        <div class="confirm-uid" id="confirm-uid"></div>
      </div>
    </div>
  </section>
</div>
<script>
(async () => {
  const ORG_SLUG = ${JSON.stringify(orgSlug)};
  const TEAM_SLUG = ${JSON.stringify(teamSlug)};
  const EVENT_SLUG = ${JSON.stringify(eventSlug)};

  let eventType = null, selectedDate = null, selectedSlot = null;
  let currentYear, currentMonth;
  let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let availableDates = new Set();

  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();

  await loadEventType();
  populateTimezones();
  renderCalendar();
  preloadMonth();

  async function loadEventType() {
    try {
      const today = fmtDate(now);
      const res = await fetch(\`/v1/slots/\${ORG_SLUG}/\${TEAM_SLUG}/\${EVENT_SLUG}?date=\${today}&timezone=\${encodeURIComponent(timezone)}\`);
      const data = await res.json();
      if (data.event_type) {
        eventType = data.event_type;
        document.getElementById('host-name').textContent = TEAM_SLUG;
        document.getElementById('event-title').textContent = eventType.title;
        const locIcon = { video:'📹', phone:'📞', in_person:'📍', other:'📌' }[eventType.location_type] || '📅';
        const locLabel = eventType.location || ({ video:'Video call', phone:'Phone call', in_person:'In person' }[eventType.location_type] || 'Meeting');
        document.getElementById('event-chips').innerHTML = \`
          <div class="chip"><div class="chip-icon">⏱</div>\${eventType.duration_minutes} min</div>
          <div class="chip"><div class="chip-icon">\${locIcon}</div>\${locLabel}</div>
          <div class="chip"><div class="chip-icon">👥</div>Team: \${TEAM_SLUG}</div>
        \`;
        document.title = 'Book: ' + eventType.title;
        if (eventType.description) { const d = document.getElementById('event-desc'); d.textContent = eventType.description; d.style.display = ''; }
      }
    } catch(e) { document.getElementById('host-name').textContent = 'Could not load'; }
  }

  function populateTimezones() {
    const sel = document.getElementById('tz-select');
    const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','Europe/Paris','Asia/Tokyo','UTC'];
    zones.forEach(z => { const o = document.createElement('option'); o.value = z; o.textContent = z; if (z === timezone) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', async () => { timezone = sel.value; availableDates.clear(); await preloadMonth(); renderCalendar(); if (selectedDate) loadSlots(selectedDate); });
  }

  function fmtDate(d) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

  async function preloadMonth() {
    const year = currentYear, month = currentMonth;
    const daysInMonth = new Date(year, month+1, 0).getDate();
    const todayStr = fmtDate(now);
    const fetches = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = \`\${year}-\${String(month+1).padStart(2,'0')}-\${String(d).padStart(2,'0')}\`;
      if (ds < todayStr) continue;
      fetches.push(fetch(\`/v1/slots/\${ORG_SLUG}/\${TEAM_SLUG}/\${EVENT_SLUG}?date=\${ds}&timezone=\${encodeURIComponent(timezone)}\`).then(r=>r.json()).then(data=>{if(data.slots?.length)availableDates.add(ds);}).catch(()=>{}));
    }
    await Promise.all(fetches);
    renderCalendar();
  }

  function renderCalendar() {
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    document.getElementById('cal-month-label').textContent = \`\${monthNames[currentMonth]} \${currentYear}\`;
    const grid = document.getElementById('cal-grid');
    grid.innerHTML = '';
    ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d => { const el = document.createElement('div'); el.className = 'cal-dow'; el.textContent = d; grid.appendChild(el); });
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

  async function selectDate(ds) { selectedDate = ds; selectedSlot = null; renderCalendar(); await loadSlots(ds); }

  async function loadSlots(ds) {
    showState('slots');
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const [y,m,d] = ds.split('-').map(Number);
    const dow = new Date(y, m-1, d).getDay();
    document.getElementById('slots-date').textContent = \`\${dayNames[dow]}, \${monthNames[m-1]} \${d}\`;
    const grid = document.getElementById('slots-grid');
    const countEl = document.getElementById('slots-count');
    grid.innerHTML = '<div class="slots-loading" style="grid-column:1/-1">Loading...</div>';
    countEl.textContent = '';
    try {
      const res = await fetch(\`/v1/slots/\${ORG_SLUG}/\${TEAM_SLUG}/\${EVENT_SLUG}?date=\${ds}&timezone=\${encodeURIComponent(timezone)}\`);
      const data = await res.json();
      grid.innerHTML = '';
      if (!data.slots?.length) { grid.innerHTML = '<div class="slots-empty" style="grid-column:1/-1">No availability on this day.</div>'; countEl.textContent = '0 slots'; return; }
      countEl.textContent = \`\${data.slots.length} slot\${data.slots.length===1?'':'s'} available\`;
      data.slots.forEach(slot => {
        const btn = document.createElement('button'); btn.className = 'slot-btn';
        const localTime = new Date(slot.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: timezone });
        btn.textContent = localTime;
        btn.addEventListener('click', () => selectSlot(slot, localTime, ds));
        grid.appendChild(btn);
      });
    } catch(e) { grid.innerHTML = '<div class="slots-empty" style="grid-column:1/-1">Error loading slots.</div>'; }
  }

  function selectSlot(slot, localTime, ds) {
    selectedSlot = slot;
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const [y,m,d] = ds.split('-').map(Number);
    document.getElementById('form-slot-time').textContent = localTime;
    document.getElementById('form-slot-meta').textContent = \`\${monthNames[m-1]} \${d}, \${y} · \${timezone}\`;
    showState('form');
  }

  document.getElementById('btn-back').addEventListener('click', () => { if (selectedDate) loadSlots(selectedDate); else showState('empty'); });

  document.getElementById('btn-confirm').addEventListener('click', async () => {
    const nameVal = document.getElementById('f-name').value.trim();
    const emailVal = document.getElementById('f-email').value.trim();
    const notes = document.getElementById('f-notes').value.trim();
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
      document.getElementById('confirm-detail').innerHTML = \`
        <div class="confirm-detail-row"><div class="confirm-detail-icon">📅</div><div><div class="confirm-detail-label">Date & Time</div><div class="confirm-detail-val">\${startLocal}</div></div></div>
        <div class="confirm-detail-row"><div class="confirm-detail-icon">🌍</div><div><div class="confirm-detail-label">Timezone</div><div class="confirm-detail-val">\${timezone}</div></div></div>
        <div class="confirm-detail-row"><div class="confirm-detail-icon">👥</div><div><div class="confirm-detail-label">Team</div><div class="confirm-detail-val">\${data.assigned_to ? 'With ' + data.assigned_to : TEAM_SLUG}</div></div></div>
      \`;
      document.getElementById('confirm-uid').textContent = 'Booking ID: ' + data.uid;
      showState('confirmed');
    } catch(e) { showError('Network error. Please try again.'); btn.disabled = false; btn.textContent = 'Confirm Booking'; }
  });

  function showError(msg) { const el = document.getElementById('form-error'); el.textContent = msg; el.style.display = 'block'; }
  function showState(state) {
    document.getElementById('state-empty').style.display = state === 'empty' ? '' : 'none';
    document.getElementById('state-slots').style.display = state === 'slots' ? '' : 'none';
    document.getElementById('state-form').style.display = state === 'form' ? '' : 'none';
    document.getElementById('state-confirmed').style.display = state === 'confirmed' ? '' : 'none';
  }

  (function(){
    const btn = document.getElementById('lightsBtn'), label = document.getElementById('lightsBtnLabel'), flicker = document.getElementById('lightsFlicker');
    let lights = localStorage.getItem('p7-lights') === '1' || (localStorage.getItem('p7-lights') === null && window.matchMedia?.('(prefers-color-scheme: light)').matches);
    function applyTheme(on) { document.documentElement.setAttribute('data-lights', on ? 'on' : 'off'); if (label) label.textContent = on ? 'LIGHTS OFF' : 'LIGHTS ON'; }
    function flickerOn(cb) { let i=0,fl=[80,60,100,50,120,40,200]; function s(){flicker.style.background=i%2===0?'rgba(255,255,230,0.18)':'rgba(255,255,230,0)';i++;if(i<fl.length)setTimeout(s,fl[i-1]);else{flicker.style.background='rgba(255,255,230,0)';cb();}}s(); }
    applyTheme(lights);
    btn.addEventListener('click', () => { if (!lights) { flickerOn(() => { lights=true; localStorage.setItem('p7-lights','1'); applyTheme(true); }); } else { lights=false; localStorage.setItem('p7-lights','0'); applyTheme(false); } });
  })();
})();
</script>
</body>
</html>`;
}
