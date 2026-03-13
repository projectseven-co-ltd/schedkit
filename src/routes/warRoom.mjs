// src/routes/warRoom.mjs — ⚡ WAR ROOM — real-time incident command center

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireSession } from '../middleware/session.mjs';

export default async function warRoomRoutes(fastify) {
  fastify.get('/incidents/war-room', {
    schema: {
      tags: ['Incidents'],
      summary: 'War Room — real-time incident command center',
      description: 'Full-screen terminal-aesthetic incident dashboard. Requires session auth.',
      hide: false,
    },
  }, async (req, reply) => {
    await requireSession(req, reply);
    if (reply.sent) return;

    // Load active incidents
    let incidents = [];
    try {
      const result = await db.find(tables.tickets,
        '(status,eq,open)~or(status,eq,in_progress)');
      incidents = (result?.list || []).sort((a, b) =>
        new Date(b.CreatedAt || b.created_at) - new Date(a.CreatedAt || a.created_at));
    } catch {}

    const html = buildWarRoom(incidents);
    return reply.type('text/html').send(html);
  });
}

function buildWarRoom(incidents) {
  const incidentsJson = JSON.stringify(incidents);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>⚡ WAR ROOM — SchedKit</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0a0a0b;
  --surface: #111114;
  --surface2: #18181e;
  --border: #1e1e28;
  --acid: #DFFF00;
  --acid-dim: rgba(223,255,0,0.08);
  --acid-glow: rgba(223,255,0,0.3);
  --text: #e8e8ea;
  --muted: #555568;
  --urgent: #ff3333;
  --high: #ff8800;
  --normal: #00aaff;
  --low: #555568;
  --ok: #00ff88;
  --warn: #ffaa00;
  --breached: #ff3333;
  --open-color: #00aaff;
  --inprog-color: #ffaa00;
  --font: 'Courier New', 'Lucida Console', monospace;
}
html, body {
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  font-size: 13px;
  overflow: hidden;
}
/* SCANLINE effect */
body::after {
  content: '';
  position: fixed;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0,0,0,0.06) 2px,
    rgba(0,0,0,0.06) 4px
  );
  pointer-events: none;
  z-index: 1000;
}
#app {
  display: grid;
  grid-template-rows: 56px 1fr;
  height: 100vh;
}
/* HEADER */
#header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 24px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: relative;
  overflow: hidden;
}
#header::before {
  content: '';
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--acid), transparent);
  opacity: 0.5;
}
#header h1 {
  color: var(--acid);
  font-size: 18px;
  font-weight: bold;
  letter-spacing: 4px;
  text-transform: uppercase;
  text-shadow: 0 0 20px var(--acid-glow);
}
#incident-count {
  background: var(--acid);
  color: var(--bg);
  font-size: 11px;
  font-weight: bold;
  padding: 2px 8px;
  border-radius: 2px;
  letter-spacing: 1px;
}
#conn-status {
  margin-left: auto;
  font-size: 11px;
  color: var(--muted);
  letter-spacing: 1px;
}
#conn-status.connected { color: var(--ok); }
#conn-status.disconnected { color: var(--urgent); }
#clock {
  font-size: 11px;
  color: var(--muted);
  letter-spacing: 2px;
}
/* MAIN LAYOUT */
#main {
  display: grid;
  grid-template-columns: 1fr 420px;
  overflow: hidden;
}
/* INCIDENT LIST */
#incident-list-wrap {
  overflow-y: auto;
  padding: 16px;
}
#incident-list-wrap::-webkit-scrollbar { width: 4px; }
#incident-list-wrap::-webkit-scrollbar-track { background: var(--bg); }
#incident-list-wrap::-webkit-scrollbar-thumb { background: var(--border); }
#list-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
#list-header span {
  font-size: 10px;
  color: var(--muted);
  letter-spacing: 2px;
  text-transform: uppercase;
}
.incident-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--border);
  margin-bottom: 8px;
  padding: 12px 14px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  position: relative;
  overflow: hidden;
}
.incident-card:hover {
  background: var(--surface2);
  border-color: var(--acid);
  border-left-color: var(--acid);
}
.incident-card.selected {
  background: var(--acid-dim);
  border-color: var(--acid);
  border-left-color: var(--acid);
}
.incident-card.new-flash {
  animation: flashIn 0.6s ease-out;
}
@keyframes flashIn {
  0% { background: rgba(223,255,0,0.25); transform: translateY(-8px); opacity: 0; }
  40% { background: rgba(223,255,0,0.15); opacity: 1; }
  100% { background: var(--surface); transform: translateY(0); }
}
.card-top {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 6px;
}
.card-title {
  flex: 1;
  font-size: 13px;
  color: var(--text);
  line-height: 1.3;
  word-break: break-word;
}
.priority-badge {
  font-size: 9px;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 2px;
  letter-spacing: 1px;
  white-space: nowrap;
  flex-shrink: 0;
}
.priority-urgent { background: rgba(255,51,51,0.2); color: var(--urgent); border: 1px solid var(--urgent); }
.priority-high { background: rgba(255,136,0,0.2); color: var(--high); border: 1px solid var(--high); }
.priority-normal { background: rgba(0,170,255,0.15); color: var(--normal); border: 1px solid var(--normal); }
.priority-low { background: rgba(85,85,104,0.2); color: var(--muted); border: 1px solid var(--muted); }
.card-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 10px;
  color: var(--muted);
}
.sla-timer {
  font-family: var(--font);
  font-size: 11px;
  font-weight: bold;
  color: var(--ok);
  letter-spacing: 1px;
}
.sla-timer.warning { color: var(--warn); }
.sla-timer.breached {
  color: var(--breached);
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.source-badge {
  font-size: 9px;
  padding: 1px 5px;
  background: rgba(255,255,255,0.05);
  border: 1px solid var(--border);
  border-radius: 2px;
  color: var(--muted);
  letter-spacing: 1px;
}
.status-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-open { background: var(--open-color); box-shadow: 0 0 4px var(--open-color); }
.status-in_progress { background: var(--inprog-color); box-shadow: 0 0 4px var(--inprog-color); animation: pulse 2s ease-in-out infinite; }
.responders-mini {
  font-size: 10px;
  color: var(--muted);
}
.responders-mini span {
  color: var(--acid);
}
/* DETAIL PANEL */
#detail-panel {
  background: var(--surface);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: transform 0.2s ease;
}
#detail-panel.empty {
  display: flex;
  align-items: center;
  justify-content: center;
}
#detail-empty {
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 2px;
  text-align: center;
  line-height: 2;
}
#detail-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
#detail-header {
  padding: 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
#detail-title {
  font-size: 14px;
  color: var(--acid);
  margin-bottom: 8px;
  line-height: 1.3;
}
#detail-badges {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
#detail-sla {
  font-size: 11px;
  color: var(--muted);
}
#detail-sla .sla-val {
  font-family: var(--font);
  font-weight: bold;
}
#join-btn {
  margin-top: 10px;
  background: var(--acid);
  color: var(--bg);
  border: none;
  padding: 6px 14px;
  font-family: var(--font);
  font-size: 11px;
  font-weight: bold;
  letter-spacing: 2px;
  cursor: pointer;
  text-transform: uppercase;
  transition: opacity 0.15s;
}
#join-btn:hover { opacity: 0.85; }
#join-btn:disabled { opacity: 0.4; cursor: default; }
#detail-desc {
  padding: 12px 16px;
  font-size: 11px;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  max-height: 80px;
  overflow-y: auto;
  line-height: 1.6;
}
#replies-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
#replies-label {
  padding: 8px 16px;
  font-size: 10px;
  color: var(--muted);
  letter-spacing: 2px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
#replies-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px;
}
#replies-list::-webkit-scrollbar { width: 3px; }
#replies-list::-webkit-scrollbar-thumb { background: var(--border); }
.reply-item {
  margin-bottom: 10px;
  padding: 8px;
  background: var(--surface2);
  border-left: 2px solid var(--border);
}
.reply-item.staff { border-left-color: var(--acid); }
.reply-meta {
  font-size: 10px;
  color: var(--muted);
  margin-bottom: 4px;
}
.reply-meta .author { color: var(--text); }
.reply-meta .staff-tag {
  color: var(--acid);
  font-size: 9px;
  margin-left: 4px;
}
.reply-body {
  font-size: 12px;
  color: var(--text);
  line-height: 1.5;
  word-break: break-word;
}
#reply-form {
  padding: 10px 16px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
#reply-input {
  width: 100%;
  background: var(--surface2);
  border: 1px solid var(--border);
  color: var(--text);
  font-family: var(--font);
  font-size: 11px;
  padding: 8px;
  resize: none;
  height: 60px;
  outline: none;
}
#reply-input:focus { border-color: var(--acid); }
#reply-submit {
  margin-top: 6px;
  background: transparent;
  border: 1px solid var(--acid);
  color: var(--acid);
  font-family: var(--font);
  font-size: 10px;
  padding: 4px 12px;
  cursor: pointer;
  letter-spacing: 2px;
  text-transform: uppercase;
  transition: background 0.15s;
}
#reply-submit:hover { background: var(--acid-dim); }
/* EMPTY STATE */
#empty-board {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
  color: var(--muted);
}
#empty-board .big { font-size: 32px; }
#empty-board p { font-size: 11px; letter-spacing: 2px; }
</style>
</head>
<body>
<div id="app">
  <div id="header">
    <h1>⚡ WAR ROOM</h1>
    <div id="incident-count">0 ACTIVE</div>
    <div id="clock">--:--:--</div>
    <div id="conn-status">● CONNECTING</div>
  </div>
  <div id="main">
    <div id="incident-list-wrap">
      <div id="list-header">
        <span>ACTIVE INCIDENTS</span>
      </div>
      <div id="incident-list"></div>
      <div id="empty-board" style="display:none">
        <div class="big">✓</div>
        <p>ALL CLEAR — NO ACTIVE INCIDENTS</p>
      </div>
    </div>
    <div id="detail-panel" class="empty">
      <div id="detail-empty">
        SELECT AN INCIDENT<br>TO VIEW DETAILS
      </div>
      <div id="detail-content" style="display:none">
        <div id="detail-header">
          <div id="detail-title"></div>
          <div id="detail-badges"></div>
          <div id="detail-sla"></div>
          <button id="join-btn">⚡ JOIN INCIDENT</button>
        </div>
        <div id="detail-desc"></div>
        <div id="replies-section">
          <div id="replies-label">REPLY THREAD</div>
          <div id="replies-list"></div>
          <div id="reply-form">
            <textarea id="reply-input" placeholder="Type your reply..."></textarea>
            <button id="reply-submit">SEND REPLY</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
(function() {
  const SLA_HOURS = { urgent: 1, high: 4, normal: 24, low: 48 };
  let incidents = ${incidentsJson};
  let selectedId = null;
  let repliesCache = {};

  // ---- Clock ----
  function updateClock() {
    document.getElementById('clock').textContent = new Date().toISOString().slice(11,19) + ' UTC';
  }
  setInterval(updateClock, 1000);
  updateClock();

  // ---- SLA helpers ----
  function slaRemaining(ticket) {
    if (!ticket.sla_due_at) return null;
    return new Date(ticket.sla_due_at).getTime() - Date.now();
  }
  function slaClass(ticket) {
    const rem = slaRemaining(ticket);
    if (rem === null) return 'ok';
    if (ticket.sla_breached || rem <= 0) return 'breached';
    const hours = SLA_HOURS[ticket.priority] || 24;
    if (rem / (hours * 3600000) <= 0.2) return 'warning';
    return 'ok';
  }
  function fmtDuration(ms) {
    if (ms <= 0) return 'BREACHED';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sc = s % 60;
    if (h > 0) return h + 'h ' + String(m).padStart(2,'0') + 'm';
    return String(m).padStart(2,'0') + ':' + String(sc).padStart(2,'0');
  }

  // ---- Render ----
  function priorityBadge(p) {
    return '<span class="priority-badge priority-' + p + '">' + p.toUpperCase() + '</span>';
  }
  function sourceBadge(s) {
    return '<span class="source-badge">' + (s||'api').toUpperCase() + '</span>';
  }
  function statusDot(s) {
    return '<span class="status-dot status-' + s + '"></span>';
  }

  function renderList() {
    const list = document.getElementById('incident-list');
    const empty = document.getElementById('empty-board');
    const countEl = document.getElementById('incident-count');
    const active = incidents.filter(i => i.status === 'open' || i.status === 'in_progress');
    countEl.textContent = active.length + ' ACTIVE';
    if (!active.length) {
      list.innerHTML = '';
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';

    // Preserve existing cards, add new ones
    const existingIds = new Set([...list.querySelectorAll('.incident-card')].map(el => el.dataset.id));
    const incomingIds = new Set(active.map(i => String(i.Id)));

    // Remove closed
    for (const el of list.querySelectorAll('.incident-card')) {
      if (!incomingIds.has(el.dataset.id)) el.remove();
    }

    for (const inc of active) {
      const id = String(inc.Id);
      let card = list.querySelector('[data-id="' + id + '"]');
      const rem = slaRemaining(inc);
      const sc = slaClass(inc);
      const slaText = rem !== null ? fmtDuration(rem) : '--';

      const inner = '<div class="card-top">' +
        statusDot(inc.status) +
        '<div class="card-title">' + escHtml(inc.title) + '</div>' +
        priorityBadge(inc.priority || 'normal') +
      '</div>' +
      '<div class="card-meta">' +
        '<span class="sla-timer ' + sc + '" data-sla-id="' + id + '">' + slaText + '</span>' +
        sourceBadge(inc.source) +
        '<span class="responders-mini" id="resp-' + id + '">…</span>' +
      '</div>';

      if (!card) {
        card = document.createElement('div');
        card.className = 'incident-card' + (existingIds.size > 0 ? ' new-flash' : '');
        card.dataset.id = id;
        card.innerHTML = inner;
        card.addEventListener('click', () => selectIncident(id));
        list.insertBefore(card, list.firstChild);
      } else {
        card.innerHTML = inner;
        card.onclick = () => selectIncident(id);
      }
      if (id === selectedId) card.classList.add('selected');
      loadResponders(id);
    }
  }

  function escHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  async function loadResponders(ticketId) {
    // We keep a lightweight approach: list responders from DB once per selection
    // For the card mini view, just show count if cached
  }

  // ---- SLA timer tick ----
  setInterval(() => {
    for (const el of document.querySelectorAll('.sla-timer[data-sla-id]')) {
      const id = el.dataset.slaId;
      const inc = incidents.find(i => String(i.Id) === id);
      if (!inc) continue;
      const rem = slaRemaining(inc);
      const sc = slaClass(inc);
      el.textContent = rem !== null ? fmtDuration(rem) : '--';
      el.className = 'sla-timer ' + sc;
      if (id === selectedId) {
        const slaEl = document.getElementById('detail-sla');
        if (slaEl) {
          const val = slaEl.querySelector('.sla-val');
          if (val) { val.textContent = rem !== null ? fmtDuration(rem) : '--'; val.className = 'sla-val ' + sc; }
        }
      }
    }
  }, 1000);

  // ---- Select incident ----
  async function selectIncident(id) {
    selectedId = id;
    document.querySelectorAll('.incident-card').forEach(el => {
      el.classList.toggle('selected', el.dataset.id === id);
    });
    const inc = incidents.find(i => String(i.Id) === id);
    if (!inc) return;

    const panel = document.getElementById('detail-panel');
    panel.classList.remove('empty');
    document.getElementById('detail-empty').style.display = 'none';
    document.getElementById('detail-content').style.display = 'flex';

    document.getElementById('detail-title').textContent = inc.title;
    document.getElementById('detail-badges').innerHTML =
      priorityBadge(inc.priority || 'normal') +
      sourceBadge(inc.source) +
      '<span class="priority-badge" style="color:#999;border-color:#333">' + (inc.status||'').toUpperCase() + '</span>';
    document.getElementById('detail-desc').textContent = inc.description || '(no description)';

    const rem = slaRemaining(inc);
    const sc = slaClass(inc);
    document.getElementById('detail-sla').innerHTML =
      'SLA: <span class="sla-val ' + sc + '">' + (rem !== null ? fmtDuration(rem) : '--') + '</span>';

    // Load replies
    await loadReplies(id);
  }

  async function loadReplies(ticketId) {
    try {
      const res = await fetch('/v1/incidents/' + ticketId + '/replies', { credentials: 'include' });
      if (!res.ok) return;
      const { replies } = await res.json();
      repliesCache[ticketId] = replies || [];
      renderReplies(ticketId);
    } catch {}
  }

  function renderReplies(ticketId) {
    const list = document.getElementById('replies-list');
    const replies = repliesCache[ticketId] || [];
    if (!replies.length) {
      list.innerHTML = '<div style="color:var(--muted);font-size:10px;padding:8px 0;letter-spacing:1px">NO REPLIES YET</div>';
      return;
    }
    list.innerHTML = replies.map(r => {
      const ts = new Date(r.created_at || r.CreatedAt).toISOString().slice(11,16);
      return '<div class="reply-item' + (r.is_staff ? ' staff' : '') + '">' +
        '<div class="reply-meta">' +
          '<span class="author">' + escHtml(r.author_name || 'Unknown') + '</span>' +
          (r.is_staff ? '<span class="staff-tag">[STAFF]</span>' : '') +
          ' <span>' + ts + '</span>' +
        '</div>' +
        '<div class="reply-body">' + escHtml(r.body) + '</div>' +
      '</div>';
    }).join('');
    list.scrollTop = list.scrollHeight;
  }

  // ---- Join button ----
  document.getElementById('join-btn').addEventListener('click', async () => {
    if (!selectedId) return;
    const btn = document.getElementById('join-btn');
    btn.disabled = true;
    try {
      const res = await fetch('/v1/incidents/' + selectedId + '/join', {
        method: 'POST', credentials: 'include'
      });
      if (res.ok) {
        btn.textContent = '✓ JOINED';
      } else {
        const j = await res.json();
        btn.textContent = j.error || 'ERROR';
        setTimeout(() => { btn.textContent = '⚡ JOIN INCIDENT'; btn.disabled = false; }, 2000);
      }
    } catch {
      btn.disabled = false;
    }
  });

  // ---- Reply submit ----
  document.getElementById('reply-submit').addEventListener('click', async () => {
    if (!selectedId) return;
    const input = document.getElementById('reply-input');
    const body = input.value.trim();
    if (!body) return;
    try {
      const res = await fetch('/v1/incidents/' + selectedId + '/replies', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        input.value = '';
        await loadReplies(selectedId);
      }
    } catch {}
  });

  // ---- SSE ----
  const status = document.getElementById('conn-status');
  function connectSSE() {
    status.textContent = '● CONNECTING';
    status.className = '';
    const es = new EventSource('/v1/incidents/stream', { withCredentials: true });
    es.onopen = () => { status.textContent = '● LIVE'; status.className = 'connected'; };
    es.onerror = () => {
      status.textContent = '● DISCONNECTED';
      status.className = 'disconnected';
      es.close();
      setTimeout(connectSSE, 3000);
    };
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        handleEvent(evt);
      } catch {}
    };
  }

  function handleEvent(evt) {
    const { type, payload } = evt;
    if (type === 'incident.created') {
      incidents.unshift(payload);
      renderList();
    } else if (type === 'incident.updated' || type === 'incident.breached' || type === 'incident.resolved') {
      const idx = incidents.findIndex(i => String(i.Id) === String(payload.Id));
      if (idx >= 0) incidents[idx] = { ...incidents[idx], ...payload };
      else if (type === 'incident.created') incidents.unshift(payload);
      renderList();
      if (selectedId === String(payload.Id)) selectIncident(selectedId);
    } else if (type === 'reply.added' && String(payload.ticket_id) === selectedId) {
      const replies = repliesCache[selectedId] || [];
      replies.push(payload.reply);
      repliesCache[selectedId] = replies;
      renderReplies(selectedId);
    } else if (type === 'responder.joined' || type === 'responder.left') {
      // Update responder count — lightweight
    }
  }

  // ---- Init ----
  renderList();
  connectSSE();
})();
</script>
</body>
</html>`;
}
