// src/routes/warRoom.mjs — ⚡ WAR ROOM — real-time incident command center

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { requireSession, getSessionUser } from '../middleware/session.mjs';

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

    // Get user's API key to inject into SSE URL (EventSource can't set headers)
    const user = await getSessionUser(req);
    const apiKey = user?.api_key || '';

    // Load active incidents
    let incidents = [];
    try {
      const result = await db.find(tables.tickets,
        '(status,eq,open)~or(status,eq,in_progress)');
      const raw = result?.list ?? result?.tickets ?? (Array.isArray(result) ? result : []);
      incidents = raw.sort((a, b) =>
        new Date(b.CreatedAt || b.created_at || 0) - new Date(a.CreatedAt || a.created_at || 0));
    } catch (e) { fastify.log.error('warroom load error: ' + e.message); }

    const html = buildWarRoom(incidents, apiKey);
    return reply.type('text/html').send(html);
  });
}

function buildWarRoom(incidents, apiKey = '') {
  const incidentsJson = JSON.stringify(incidents).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const apiKeyJson = JSON.stringify(apiKey || '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>[!] WAR ROOM — SchedKit</title>
<link rel="manifest" href="/manifest.json">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="SchedKit">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
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
/* TAB BAR */
#tab-bar {
  display: flex;
  gap: 4px;
  align-items: center;
  margin-left: 16px;
}
.tab-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
  font-family: var(--font);
  font-size: 10px;
  font-weight: bold;
  letter-spacing: 2px;
  padding: 3px 12px;
  cursor: pointer;
  text-transform: uppercase;
  transition: color 0.15s, border-color 0.15s;
}
.tab-btn:hover { color: var(--text); border-color: var(--acid); }
.tab-btn.active { color: var(--acid); border-color: var(--acid); background: var(--acid-dim); }
/* VIEWS */
#view-list { display: grid; grid-template-columns: 1fr 420px; overflow: hidden; height: 100%; }
#view-map { display: none; height: 100%; position: relative; }
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
/* MAP */
#map-container {
  width: 100%;
  height: 100%;
  background: #0a0a0b;
}
/* Map overlay panels */
#map-beacon-panel {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 1000;
  width: 220px;
  background: rgba(10,10,11,0.92);
  border: 1px solid rgba(0,255,204,0.2);
  border-radius: 8px;
  overflow: hidden;
  backdrop-filter: blur(8px);
  font-family: 'Fira Code', monospace;
  max-height: 280px;
  display: flex;
  flex-direction: column;
}
#map-feed-panel {
  position: absolute;
  bottom: 16px;
  left: 16px;
  z-index: 1000;
  width: 300px;
  background: rgba(10,10,11,0.88);
  border: 1px solid rgba(223,255,0,0.12);
  border-radius: 8px;
  overflow: hidden;
  backdrop-filter: blur(8px);
  font-family: 'Fira Code', monospace;
  max-height: 200px;
  display: flex;
  flex-direction: column;
}
.mbp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 9px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: rgba(223,255,0,0.5);
  border-bottom: 1px solid rgba(255,255,255,0.05);
  flex-shrink: 0;
}
.mbp-count {
  background: rgba(0,255,204,0.15);
  color: #00ffcc;
  border-radius: 10px;
  padding: 1px 7px;
  font-size: 10px;
}
#beacon-units-list {
  overflow-y: auto;
  flex: 1;
}
#beacon-units-list::-webkit-scrollbar { display: none; }
#wr-feed {
  overflow-y: auto;
  flex: 1;
  padding: 4px 0;
}
#wr-feed::-webkit-scrollbar { display: none; }
#wr-feed .sitrep-feed-item {
  padding: 5px 12px;
  font-size: 11px;
}
#map-no-geo {
  display: none;
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  z-index: 500;
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 24px 32px;
  text-align: center;
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 2px;
  pointer-events: none;
}
/* Leaflet popup dark override */
.leaflet-popup-content-wrapper {
  background: #111114 !important;
  color: #e8e8ea !important;
  border: 1px solid #1e1e28 !important;
  border-radius: 2px !important;
  font-family: 'Courier New', monospace !important;
  font-size: 12px !important;
}
.leaflet-popup-tip { background: #111114 !important; }
.leaflet-popup-content { margin: 12px 16px !important; }
.map-popup-title { color: #DFFF00; font-weight: bold; margin-bottom: 8px; font-size: 14px; }
.map-popup-row { color: #aaaacc; font-size: 12px; margin-bottom: 4px; }
.map-popup-row span { color: #e8e8ea; }
.map-popup-btn {
  display: block;
  margin-top: 10px;
  background: #DFFF00;
  color: #0a0a0b;
  border: none;
  padding: 8px 14px;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  font-weight: bold;
  letter-spacing: 2px;
  cursor: pointer;
  text-transform: uppercase;
  text-decoration: none;
  text-align: center;
}
/* Urgent pulse animation for Leaflet markers */
@keyframes urgentPulse {
  0% { box-shadow: 0 0 0 0 rgba(255,51,51,0.7); }
  70% { box-shadow: 0 0 0 12px rgba(255,51,51,0); }
  100% { box-shadow: 0 0 0 0 rgba(255,51,51,0); }
}
.marker-urgent { animation: urgentPulse 1.4s ease-out infinite; }
</style>
</head>
<body>
<div id="app">
  <div id="header">
    <h1>[!] WAR ROOM</h1>
    <div id="incident-count">0 ACTIVE</div>
    <div id="tab-bar">
      <button class="tab-btn active" id="tab-list" onclick="switchTab('list')">LIST</button>
      <button class="tab-btn" id="tab-map" onclick="switchTab('map')">MAP</button>
    </div>
    <div id="clock">--:--:--</div>
    <button class="wr-mode-btn" onclick="wrCycleMode()" title="Long-press for day" style="background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;letter-spacing:.08em;color:#5a5a6e;touch-action:none;user-select:none"><span id="wr-mode-label">[&#9681;] NITE</span></button>
    <div id="conn-status">● CONNECTING</div>
  </div>
  <div id="view-list">
    <div id="incident-list-wrap">
      <div id="list-header">
        <span>ACTIVE INCIDENTS</span>
      </div>
      <div id="incident-list"></div>
      <div id="empty-board" style="display:none">
        <div class="big">[✓]</div>
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
          <button id="join-btn">[+] JOIN INCIDENT</button>
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
  <div id="view-map">
    <div id="map-container"></div>
    <div id="map-no-geo">NO GEO DATA — INCLUDE lat/lng WHEN CREATING INCIDENTS</div>
    <!-- Beacon units overlay on map -->
    <div id="map-beacon-panel">
      <div class="mbp-header">
        <span>[+] ACTIVE BEACONS</span>
        <span id="beacon-units-count" class="mbp-count">0</span>
      </div>
      <div id="beacon-units-list"></div>
    </div>
    <!-- Live feed overlay on map -->
    <div id="map-feed-panel">
      <div class="mbp-header">[~] ACTIVITY</div>
      <div id="wr-feed"></div>
    </div>
  </div>
</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script id="wr-data" type="application/json">${incidentsJson}</script>
<script id="wr-key" type="application/json">${apiKeyJson}</script>
<script>
(function() {
  const SLA_HOURS = { urgent: 1, high: 4, normal: 24, low: 48 };
  let incidents = JSON.parse(document.getElementById('wr-data').textContent);
  const _apiKey = JSON.parse(document.getElementById('wr-key').textContent);
  let selectedId = null;
  let repliesCache = {};

  // ---- Tab switching ----
  let currentTab = 'list';
  let mapInitialized = false;
  window.switchTab = function(tab) {
    currentTab = tab;
    document.getElementById('view-list').style.display = tab === 'list' ? 'grid' : 'none';
    document.getElementById('view-map').style.display = tab === 'map' ? 'block' : 'none';
    document.getElementById('tab-list').classList.toggle('active', tab === 'list');
    document.getElementById('tab-map').classList.toggle('active', tab === 'map');
    if (tab === 'map' && !mapInitialized) {
      mapInitialized = true;
      initMap();
    } else if (tab === 'map') {
      leafletMap && leafletMap.invalidateSize();
    }
  };

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

    const existingIds = new Set([...list.querySelectorAll('.incident-card')].map(el => el.dataset.id));
    const incomingIds = new Set(active.map(i => String(i.Id)));

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
    }
  }

  function escHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

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

  async function selectIncident(id) {
    selectedId = id;
    // Reset join button state
    const btn = document.getElementById('join-btn');
    btn.textContent = '[+] JOIN INCIDENT';
    btn.disabled = false;
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

  document.getElementById('join-btn').addEventListener('click', async () => {
    if (!selectedId) return;
    const btn = document.getElementById('join-btn');
    btn.disabled = true;
    try {
      const res = await fetch('/v1/incidents/' + selectedId + '/join?api_key=' + _apiKey, {
        method: 'POST'
      });
      if (res.ok) {
        btn.textContent = '[✓] JOINED';
      } else {
        const j = await res.json();
        btn.textContent = j.error || 'ERROR';
        setTimeout(() => { btn.textContent = '[+] JOIN INCIDENT'; btn.disabled = false; }, 2000);
      }
    } catch {
      btn.disabled = false;
    }
  });

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

  // ---- MAP ----
  let leafletMap = null;
  const incidentMarkers = new Map(); // id -> { marker, circle }
  const responderMarkers = new Map(); // user_id -> marker

  // Beacon markers keyed by device_id (more specific than user_id)
  // Each entry: { marker, accuracyCircle, labelMarker, lastSeen, userId, lat, lng }
  const beaconMarkers = new Map();
  const BEACON_STALE_MS = 120000; // 2 min — remove dot if no ping

  // Priority pin colors (SLA-independent default)
  const PRIORITY_COLORS = { urgent: '#ff3333', high: '#ff8800', normal: '#00aaff', low: '#555568' };
  const SLA_COLORS = { ok: '#00ff88', warning: '#ffaa00', breached: '#ff3333' };

  function markerColor(inc) {
    const sc = slaClass(inc);
    return SLA_COLORS[sc] || PRIORITY_COLORS[inc.priority] || '#00aaff';
  }

  function initMap() {
    leafletMap = L.map('map-container', {
      zoomControl: true,
      attributionControl: false,
    }).setView([37.8, -96], 4); // Default: CONUS

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(leafletMap);

    const withGeo = incidents.filter(i =>
      (i.status === 'open' || i.status === 'in_progress') &&
      i.lat != null && i.lng != null);

    if (withGeo.length > 0) {
      document.getElementById('map-no-geo').style.display = 'none';
      for (const inc of withGeo) addIncidentMarker(inc);
      fitMapToMarkers();
    } else {
      document.getElementById('map-no-geo').style.display = 'block';
    }

    // Load historical captures and pin them
    loadHistoricalSignals();
  }

  function makeCircleMarker(inc) {
    const color = markerColor(inc);
    const radius = inc.priority === 'urgent' ? 14 : 10;
    const marker = L.circleMarker([inc.lat, inc.lng], {
      radius,
      color,
      fillColor: color,
      fillOpacity: 0.85,
      weight: 2,
    });

    // For urgent: add CSS pulse via custom pane/className trick
    // We use a divIcon wrapper for urgent
    if (inc.priority === 'urgent') {
      const icon = L.divIcon({
        className: '',
        html: '<div class="marker-urgent" style="width:20px;height:20px;border-radius:50%;background:#ff3333;border:2px solid #ff6666;opacity:0.9"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      return L.marker([inc.lat, inc.lng], { icon });
    }
    return marker;
  }

  function popupHtml(inc) {
    const sc = slaClass(inc);
    const rem = slaRemaining(inc);
    const slaText = rem !== null ? fmtDuration(rem) : '--';
    return '<div class="map-popup-title">' + escHtml(inc.title) + '</div>' +
      '<div class="map-popup-row">PRIORITY: <span class="' + 'priority-' + (inc.priority||'normal') + '">' + (inc.priority||'normal').toUpperCase() + '</span></div>' +
      '<div class="map-popup-row">SLA: <span style="color:' + (SLA_COLORS[sc]||'#00ff88') + '">' + slaText + '</span></div>' +
      '<div class="map-popup-row">STATUS: <span>' + (inc.status||'').toUpperCase() + '</span></div>' +
      (inc.location_name ? '<div class="map-popup-row">LOC: <span>' + escHtml(inc.location_name) + '</span></div>' : '') +
      '<a class="map-popup-btn" onclick="switchTab(&quot;list&quot;);selectIncident(&quot;' + inc.Id + '&quot;);return false;" href="#">OPEN INCIDENT</a>';
  }

  function addIncidentMarker(inc) {
    if (!leafletMap) return;
    if (inc.lat == null || inc.lng == null) return;

    const marker = makeCircleMarker(inc);
    marker.addTo(leafletMap).bindPopup(popupHtml(inc), { maxWidth: 260 });
    incidentMarkers.set(String(inc.Id), marker);
  }

  function updateIncidentMarker(inc) {
    if (!leafletMap) return;
    const id = String(inc.Id);
    const existing = incidentMarkers.get(id);
    if (existing) {
      leafletMap.removeLayer(existing);
      incidentMarkers.delete(id);
    }
    if (inc.lat != null && inc.lng != null &&
        (inc.status === 'open' || inc.status === 'in_progress')) {
      addIncidentMarker(inc);
    }
    checkGeoEmpty();
  }

  function removeIncidentMarker(id) {
    const m = incidentMarkers.get(String(id));
    if (m && leafletMap) { leafletMap.removeLayer(m); incidentMarkers.delete(String(id)); }
    checkGeoEmpty();
  }

  function checkGeoEmpty() {
    document.getElementById('map-no-geo').style.display =
      incidentMarkers.size === 0 ? 'block' : 'none';
  }

  function fitMapToMarkers(animate = false) {
    if (!leafletMap || incidentMarkers.size === 0) return;
    const group = L.featureGroup([...incidentMarkers.values()]);
    const bounds = group.getBounds().pad(0.3);
    if (animate) {
      leafletMap.flyToBounds(bounds, { duration: 1.4, easeLinearity: 0.1 });
    } else {
      leafletMap.fitBounds(bounds);
    }
  }

  function updateResponderDot(user_id, lat, lng) {
    // Legacy responder.moved fallback — treat as beacon ping with no device_id
    updateBeaconDot('user-' + user_id, user_id, lat, lng, null, null);
  }

  function updateBeaconDot(deviceId, userId, lat, lng, accuracy, label) {
    if (!leafletMap || lat == null || lng == null) return;

    const key = String(deviceId || ('user-' + userId));
    const existing = beaconMarkers.get(key);
    if (existing) {
      leafletMap.removeLayer(existing.marker);
      if (existing.accuracyCircle) leafletMap.removeLayer(existing.accuracyCircle);
      if (existing.labelMarker) leafletMap.removeLayer(existing.labelMarker);
    }

    // Accuracy ring
    let accuracyCircle = null;
    if (accuracy && accuracy > 0) {
      accuracyCircle = L.circle([lat, lng], {
        radius: accuracy,
        color: '#00ffcc',
        fillColor: '#00ffcc',
        fillOpacity: 0.05,
        weight: 1,
        dashArray: '4 4',
      }).addTo(leafletMap);
    }

    // Dot
    const shortId = String(deviceId || userId).slice(-6);
    const displayLabel = label || shortId;
    const icon = L.divIcon({
      className: '',
      html: \`<div style="
        width:14px;height:14px;border-radius:50%;
        background:#00ffcc;border:2px solid rgba(0,255,204,0.6);
        box-shadow:0 0 8px rgba(0,255,204,0.7);
        animation:beaconPing 2s ease-out infinite;
      "></div>\`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    const marker = L.marker([lat, lng], { icon }).addTo(leafletMap);
    marker.bindPopup(\`
      <div class="map-popup-title">[+] Beacon</div>
      <div class="map-popup-row">Device <span>\${displayLabel}</span></div>
      <div class="map-popup-row">Coords <span>\${lat.toFixed(5)}, \${lng.toFixed(5)}</span></div>
      \${accuracy ? \`<div class="map-popup-row">Accuracy <span>±\${Math.round(accuracy)}m</span></div>\` : ''}
    \`);

    // Label marker (floating text above dot)
    const labelIcon = L.divIcon({
      className: '',
      html: \`<div style="font-family:'Fira Code',monospace;font-size:9px;color:#00ffcc;letter-spacing:0.08em;white-space:nowrap;text-shadow:0 0 4px rgba(0,0,0,0.9);margin-top:-18px;margin-left:8px;">\${displayLabel}</div>\`,
      iconSize: [80, 14],
      iconAnchor: [0, 14],
    });
    const labelMarker = L.marker([lat, lng], { icon: labelIcon, interactive: false }).addTo(leafletMap);

    beaconMarkers.set(key, { marker, accuracyCircle, labelMarker, lastSeen: Date.now(), userId, lat, lng, deviceId });
    updateBeaconPanel();
  }

  function removeBeaconDot(deviceId, userId) {
    const key = String(deviceId || ('user-' + userId));
    const existing = beaconMarkers.get(key);
    if (!existing) return;
    leafletMap && leafletMap.removeLayer(existing.marker);
    existing.accuracyCircle && leafletMap && leafletMap.removeLayer(existing.accuracyCircle);
    existing.labelMarker && leafletMap && leafletMap.removeLayer(existing.labelMarker);
    beaconMarkers.delete(key);
    updateBeaconPanel();
  }

  // Prune stale beacons every 30s
  setInterval(() => {
    const now = Date.now();
    for (const [key, b] of beaconMarkers) {
      if (now - b.lastSeen > BEACON_STALE_MS) removeBeaconDot(b.deviceId, b.userId);
    }
  }, 30000);

  // ---- Beacon panel (sidebar) ----
  function updateBeaconPanel() {
    const panel = document.getElementById('beacon-units-list');
    if (!panel) return;
    if (beaconMarkers.size === 0) {
      panel.innerHTML = '<div style="padding:12px 16px;font-size:11px;color:var(--muted,#5a5a6e);">No active beacons</div>';
      document.getElementById('beacon-units-count').textContent = '0';
      return;
    }
    document.getElementById('beacon-units-count').textContent = String(beaconMarkers.size);
    panel.innerHTML = [...beaconMarkers.values()].map(b => {
      const age = Math.round((Date.now() - b.lastSeen) / 1000);
      const ageStr = age < 60 ? age + 's ago' : Math.round(age/60) + 'm ago';
      const shortId = String(b.deviceId || b.userId).slice(-6);
      return \`<div class="beacon-unit-row" onclick="flyToBeacon('\${b.lat}','\${b.lng}')">
        <div style="width:8px;height:8px;border-radius:50%;background:#00ffcc;flex-shrink:0;box-shadow:0 0 6px #00ffcc;animation:beaconPing 2s infinite"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;color:#e8e8ea;font-family:'Fira Code',monospace;">\${shortId}</div>
          <div style="font-size:10px;color:var(--muted,#5a5a6e);">\${b.lat.toFixed(4)}, \${b.lng.toFixed(4)}</div>
        </div>
        <div style="font-size:10px;color:var(--muted,#5a5a6e);flex-shrink:0;">\${ageStr}</div>
      </div>\`;
    }).join('');
  }
  window.flyToBeacon = function(lat, lng) {
    if (!leafletMap) { switchTab('map'); setTimeout(() => leafletMap && leafletMap.flyTo([+lat, +lng], 14), 300); return; }
    switchTab('map');
    leafletMap.flyTo([+lat, +lng], 14);
  };

  // ---- Alert flash ----
  function flashAlert(lat, lng, note) {
    if (!leafletMap) return;
    const icon = L.divIcon({
      className: '',
      html: '<div style="width:24px;height:24px;border-radius:50%;background:#ff3333;border:3px solid #ff6666;box-shadow:0 0 20px rgba(255,50,50,0.8);animation:alertFlash 0.4s ease-in-out infinite alternate;"></div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
    const m = L.marker([lat, lng], { icon })
      .bindPopup('<div class="map-popup-title" style="color:#ff5f5f">[!] ALERT</div><div class="map-popup-row">' + (note || 'Operator triggered') + '</div>')
      .addTo(leafletMap);
    m.openPopup();
    // Remove after 60s
    setTimeout(() => { try { leafletMap.removeLayer(m); } catch {} }, 60000);
  }

  // ---- SSE ----
  const status = document.getElementById('conn-status');
  function connectSSE() {
    status.textContent = '● CONNECTING';
    status.className = '';
    const es = new EventSource('/v1/incidents/stream?api_key=' + _apiKey, { withCredentials: true });
    es.onopen = () => { status.textContent = '● LIVE'; status.className = 'connected'; };
    es.onerror = () => {
      status.textContent = '● DISCONNECTED';
      status.className = 'disconnected';
      es.close();
      setTimeout(connectSSE, 3000);
    };
    es.onmessage = (e) => {
      try { handleEvent(JSON.parse(e.data)); } catch {}
    };
  }

  function connectSignalSSE() {
    const es = new EventSource('/v1/signals/stream?api_key=' + _apiKey, { withCredentials: true });
    es.onerror = () => { es.close(); setTimeout(connectSignalSSE, 5000); };
    es.onmessage = (e) => {
      try { handleSignalEvent(JSON.parse(e.data)); } catch {}
    };
  }

  // Load historical captures + recent beacons from REST, pin on map
  async function loadHistoricalSignals() {
    try {
      const res = await fetch('/v1/signals?limit=200&sort=-Id', {
        headers: { 'x-api-key': _apiKey }
      });
      if (!res.ok) return;
      const { signals = [] } = await res.json();
      const captures = signals.filter(s => s.type === 'capture' && s.lat != null);
      for (const c of captures) {
        let meta = {};
        try { meta = JSON.parse(c.meta || '{}'); } catch {}
        const deviceId = meta.device_id || ('user-' + c.user_id);
        addCapturePin(c, deviceId, true);
      }
      if (captures.length > 0) {
        document.getElementById('map-no-geo').style.display = 'none';
        // Fit map to capture pins if no incidents had geo
        const bounds = captures.map(c => [+c.lat, +c.lng]);
        if (bounds.length === 1) {
          leafletMap.setView(bounds[0], 14);
        } else if (bounds.length > 1) {
          leafletMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
        }
      }
      // Also show recent beacon locations (last known position per device)
      const beaconsByDevice = {};
      signals.filter(s => s.type === 'beacon_on' && s.lat != null).forEach(s => {
        let meta = {};
        try { meta = JSON.parse(s.meta || '{}'); } catch {}
        const did = meta.device_id || ('user-' + s.user_id);
        if (!beaconsByDevice[did]) beaconsByDevice[did] = s;
      });
    } catch (e) { console.warn('historical signals load failed', e); }
  }

  function handleSignalEvent(evt) {
    const { type, payload } = evt;
    if (!payload) return;
    let meta = {};
    try { meta = JSON.parse(payload.meta || '{}'); } catch {}
    // device_id can come from meta (beacon pings) or directly on payload (beacon_off)
    const deviceId = payload.device_id || meta.device_id || ('user-' + payload.user_id);
    const shortId = deviceId.slice(-8);

    if (type === 'signal.beacon') {
      if (payload.lat != null) {
        if (!mapInitialized && beaconMarkers.size === 0) {
          // First beacon — auto-switch to map
          switchTab('map');
          setTimeout(() => updateBeaconDot(deviceId, payload.user_id, +payload.lat, +payload.lng, payload.accuracy, deviceId), 400);
        } else {
          updateBeaconDot(deviceId, payload.user_id, +payload.lat, +payload.lng, payload.accuracy, deviceId);
        }
      }
      addFeedItem('beacon', '[+] Beacon · ' + shortId + (payload.lat ? ' · ' + (+payload.lat).toFixed(4) + ', ' + (+payload.lng).toFixed(4) : ''));
    } else if (type === 'signal.beacon_off') {
      removeBeaconDot(deviceId, payload.user_id);
      addFeedItem('muted', '[-] Offline · ' + shortId);
    } else if (type === 'signal.alert') {
      if (payload.lat != null && mapInitialized) flashAlert(+payload.lat, +payload.lng, payload.note);
      addFeedItem('alert', '[!] Alert · ' + shortId + (payload.note ? ' · ' + payload.note : ''));
    } else if (type === 'signal.capture') {
      if (payload.lat != null && mapInitialized) addCapturePin(payload, deviceId);
      const hasImg = !!(payload.image_url);
      const imgSrc = hasImg ? (payload.image_url.startsWith('/') ? payload.image_url : '/captures/' + payload.image_url.split('/').pop()) : null;
      const coords = payload.lat ? \` · \${(+payload.lat).toFixed(4)}, \${(+payload.lng).toFixed(4)}\` : '';
      const clickHandler = imgSrc ? \` style="cursor:pointer" onclick="showCaptureLightbox('\${imgSrc}', '\${shortId}\${coords}')"\` : '';
      addFeedItem('capture', \`[▲] Capture · \${shortId}\${coords}\`, clickHandler);
    } else if (type === 'signal.note') {
      addFeedItem('muted', '[~] Note · ' + shortId + ' · ' + (payload.note || '').slice(0, 60));
    }
  }


  function addCapturePin(payload, deviceId, historical) {
    if (!leafletMap || payload.lat == null || payload.lng == null) return;
    const shortId = (deviceId || '').slice(-8);
    const hasImage = !!(payload.image_url && payload.image_url.length > 0);
    const icon = L.divIcon({
      className: '',
      html: \`<div style="width:22px;height:22px;border-radius:3px;background:#8b5cf6;border:2px solid #a78bfa;display:flex;align-items:center;justify-content:center;font-size:11px;font-family:monospace;font-weight:700;color:#e8e8ea;box-shadow:0 0 10px rgba(139,92,246,0.6);\${historical ? 'opacity:0.7' : ''}">&#9650;</div>\`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    const ts = payload.created_at || payload.CreatedAt || new Date().toISOString();
    const timeStr = new Date(ts).toISOString().slice(11,19) + ' UTC';
    const dateStr = new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const coords = \`\${(+payload.lat).toFixed(5)}, \${(+payload.lng).toFixed(5)}\`;

    const m = L.marker([+payload.lat, +payload.lng], { icon }).addTo(leafletMap);
    m.on('click', function() {
      let html = \`<div class="map-popup-title" style="color:#a78bfa">[▲] Capture</div>
        <div class="map-popup-row">Device <span>\${escHtml(shortId)}</span></div>
        <div class="map-popup-row">Time <span>\${dateStr} \${timeStr}</span></div>
        <div class="map-popup-row">Coords <span>\${coords}</span></div>\`;
      if (hasImage) {
        const imgSrc = payload.image_url.startsWith('/') ? payload.image_url : '/captures/' + payload.image_url.split('/').pop();
        const meta = \`\${shortId} · \${dateStr} \${timeStr} · \${coords}\`;
        html += \`<div style="margin-top:10px;cursor:pointer;position:relative;" onclick="showCaptureLightbox('\${imgSrc}', '\${escHtml(meta)}')">
          <img src="\${imgSrc}" style="width:100%;max-width:240px;border-radius:4px;border:1px solid rgba(167,139,250,0.3);display:block;" onerror="this.style.display='none';this.nextSibling.style.display='block'">
          <div style="display:none;padding:8px;background:#1a1020;border:1px dashed #a78bfa;border-radius:4px;font-size:11px;color:#a78bfa;">[▲] Image unavailable</div>
          <div style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.7);border-radius:3px;padding:2px 5px;font-size:9px;color:#a78bfa;font-family:monospace">[→] EXPAND</div>
        </div>\`;
      }
      m.bindPopup(L.popup({ maxWidth: 280 }).setContent(html)).openPopup();
    });
    return m;
  }

  function addFeedItem(kind, text, extraAttrs) {
    const feed = document.getElementById('wr-feed');
    if (!feed) return;
    const now = new Date().toISOString().slice(11,19);
    const dot = kind === 'alert' ? '#ff5f5f' : kind === 'capture' ? '#a78bfa' : kind === 'ok' ? '#4ade80' : kind === 'muted' ? 'var(--muted,#5a5a6e)' : kind === 'incident' ? '#60a5fa' : '#00ffcc';
    const item = document.createElement('div');
    item.className = 'sitrep-feed-item';
    item.innerHTML = \`<div\${extraAttrs||''} style="flex:1;font-family:'Fira Code',monospace;"><span style="color:var(--muted,#5a5a6e);font-size:9px;">\${now} </span><span style="font-size:11px;letter-spacing:0.02em;color:\${dot}">\${text}</span></div>\`;
    feed.insertBefore(item, feed.firstChild);
    while (feed.children.length > 50) feed.removeChild(feed.lastChild);
  }

  function handleEvent(evt) {
    const { type, payload } = evt;
    if (type === 'incident.created') {
      incidents.unshift(payload);
      renderList();
      if (mapInitialized && payload.lat != null) { addIncidentMarker(payload); fitMapToMarkers(true); checkGeoEmpty(); }
      addFeedItem('incident', '[■] Incident · ' + (payload.title || payload.subject || '#' + payload.Id) + ' · ' + (payload.priority || 'normal').toUpperCase());
    } else if (type === 'incident.updated' || type === 'incident.breached') {
      const idx = incidents.findIndex(i => String(i.Id) === String(payload.Id));
      if (idx >= 0) incidents[idx] = { ...incidents[idx], ...payload };
      else incidents.unshift(payload);
      renderList();
      if (selectedId === String(payload.Id)) selectIncident(selectedId);
      if (mapInitialized) updateIncidentMarker(payload);
      if (type === 'incident.breached') addFeedItem('alert', '[×] SLA breach · ' + (payload.title || '#' + payload.Id));
    } else if (type === 'incident.resolved') {
      const idx = incidents.findIndex(i => String(i.Id) === String(payload.Id));
      if (idx >= 0) incidents[idx] = { ...incidents[idx], ...payload };
      renderList();
      if (mapInitialized) { removeIncidentMarker(payload.Id); fitMapToMarkers(true); }
      addFeedItem('ok', '[✓] Resolved · ' + (payload.title || '#' + payload.Id));
    } else if (type === 'reply.added' && String(payload.ticket_id) === selectedId) {
      const replies = repliesCache[selectedId] || [];
      replies.push(payload.reply);
      repliesCache[selectedId] = replies;
      renderReplies(selectedId);
    } else if (type === 'responder.moved') {
      if (mapInitialized) updateResponderDot(payload.user_id, payload.lat, payload.lng);
    }
  }

  // ---- Init ----
  renderList();
  connectSSE();
  connectSignalSSE();
})();
</script>
<style>
@keyframes beaconPing {
  0%, 100% { box-shadow: 0 0 4px rgba(0,255,204,0.5); }
  50% { box-shadow: 0 0 16px rgba(0,255,204,0.9), 0 0 32px rgba(0,255,204,0.3); }
}
@keyframes alertFlash {
  from { box-shadow: 0 0 10px rgba(255,50,50,0.6); }
  to   { box-shadow: 0 0 30px rgba(255,50,50,1); }
}
.beacon-unit-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border, #1e1e28);
  cursor: pointer;
  transition: background 0.1s;
}
.beacon-unit-row:hover { background: rgba(0,255,204,0.04); }
.beacon-unit-row:last-child { border-bottom: none; }
/* -- NITE mode -- */
[data-lights="nite"] #app { filter: saturate(0.15) brightness(0.55); }
[data-lights="nite"] * { animation-play-state: paused !important; }
/* -- NVG mode -- */
[data-lights="nvg"] #app { filter: saturate(0.05) brightness(0.3); }
[data-lights="nvg"] * { animation-play-state: paused !important; }
[data-lights="nvg"] .leaflet-container { filter: saturate(0.05) brightness(0.25) hue-rotate(160deg); }
</style>
<script>
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
</script>
<script>
(function(){
  var TACTICAL=['dark','nite','nvg'];
  var MLABELS={dark:'NITE',day:'DARK',nite:'NVG',nvg:'DARK'};
  var MSIGILS={dark:'[\u25d1]',day:'[\u2600]',nite:'[\u258c]',nvg:'[\u25c8]'};
  var stored=localStorage.getItem('p7-display-mode')||'dark';
  if(stored==='off'||stored==='on')stored=stored==='on'?'day':'dark';
  var mode=['dark','day','nite','nvg'].indexOf(stored)>=0?stored:'dark';
  var _preDay='dark';
  function applyMode(m){
    mode=m;localStorage.setItem('p7-display-mode',m);
    document.documentElement.setAttribute('data-lights',m);
    var el=document.getElementById('wr-mode-label');
    if(el)el.textContent=MSIGILS[m]+' '+MLABELS[m];
  }
  applyMode(mode);
  window.wrCycleMode=function(){applyMode(TACTICAL[(TACTICAL.indexOf(mode)+1)%TACTICAL.length]);};
  var _pt=null;
  document.addEventListener('DOMContentLoaded',function(){
    var b=document.querySelector('.wr-mode-btn');
    if(!b)return;
    b.addEventListener('pointerdown',function(){_pt=setTimeout(function(){_pt=null;if(mode==='day')applyMode(_preDay);else{_preDay=mode;applyMode('day');}},500);});
    b.addEventListener('pointerup',function(){if(!_pt)return;clearTimeout(_pt);_pt=null;wrCycleMode();});
    b.addEventListener('pointercancel',function(){clearTimeout(_pt);_pt=null;});
    b.addEventListener('contextmenu',function(e){e.preventDefault();});
    b.removeAttribute('onclick');
  });
})();
</script>

<!-- Capture lightbox -->
<div id="capture-lightbox" style="display:none;position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.94);backdrop-filter:blur(8px);align-items:center;justify-content:center;flex-direction:column;gap:0;" onclick="hideCaptureLightbox()">
  <div style="position:relative;max-width:min(92vw,900px);width:100%;display:flex;flex-direction:column;" onclick="event.stopPropagation()">
    <!-- header bar -->
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#0f0f13;border:1px solid #2a2a36;border-bottom:none;border-radius:8px 8px 0 0;">
      <div style="font-family:'Fira Code',monospace;font-size:11px;color:#a78bfa;letter-spacing:0.08em;">[▲] CAPTURE IMAGE</div>
      <div style="display:flex;gap:16px;align-items:center;">
        <a id="capture-lightbox-dl" href="" download style="font-family:'Fira Code',monospace;font-size:11px;color:#5a5a6e;text-decoration:none;letter-spacing:0.06em;" onclick="event.stopPropagation()">[↓] download</a>
        <span style="font-family:'Fira Code',monospace;font-size:13px;color:#5a5a6e;cursor:pointer;letter-spacing:0.04em;" onclick="hideCaptureLightbox()">[×] close</span>
      </div>
    </div>
    <!-- image -->
    <div style="background:#090909;border:1px solid #2a2a36;border-bottom:none;display:flex;align-items:center;justify-content:center;min-height:200px;max-height:75vh;overflow:hidden;">
      <img id="capture-lightbox-img" src="" style="max-width:100%;max-height:75vh;object-fit:contain;display:block;" onerror="this.style.display='none';document.getElementById('capture-lb-err').style.display='flex'">
      <div id="capture-lb-err" style="display:none;flex-direction:column;align-items:center;gap:8px;padding:40px;color:#5a5a6e;font-family:'Fira Code',monospace;font-size:12px;">[▲] Image unavailable</div>
    </div>
    <!-- meta footer -->
    <div id="capture-lightbox-meta" style="padding:8px 14px;background:#0f0f13;border:1px solid #2a2a36;border-radius:0 0 8px 8px;font-family:'Fira Code',monospace;font-size:10px;color:#5a5a6e;letter-spacing:0.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>
  </div>
  <div style="margin-top:12px;font-family:'Fira Code',monospace;font-size:10px;color:#2a2a3a;letter-spacing:0.06em;">click outside or ESC to close</div>
</div>
<script>
function showCaptureLightbox(src, meta) {
  const lb = document.getElementById('capture-lightbox');
  const img = document.getElementById('capture-lightbox-img');
  const err = document.getElementById('capture-lb-err');
  const metaEl = document.getElementById('capture-lightbox-meta');
  const dl = document.getElementById('capture-lightbox-dl');
  img.style.display = 'block';
  err.style.display = 'none';
  img.src = src;
  dl.href = src;
  dl.download = src.split('/').pop() || 'capture.jpg';
  metaEl.textContent = meta ? '[▲] ' + meta : '';
  lb.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function hideCaptureLightbox() {
  document.getElementById('capture-lightbox').style.display = 'none';
  document.getElementById('capture-lightbox-img').src = '';
  document.body.style.overflow = '';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCaptureLightbox(); });
</script>
</body>
</html>`;
}
