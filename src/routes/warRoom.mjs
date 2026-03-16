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
#view-list { display: none; flex-direction: column; overflow: hidden; height: 100%; }
#incident-list-wrap { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
#view-map { display: block; height: 100%; position: relative; }
/* INCIDENT LIST */
/* ── Command board ─────────────────────────────────────────────── */
#list-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
}
#list-header span {
  font-size: 10px;
  color: var(--muted);
  letter-spacing: 2px;
  text-transform: uppercase;
}
#board-filters { display: flex; gap: 4px; flex-wrap: wrap; }
.bfbtn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
  font-family: 'Fira Code', monospace;
  font-size: 9px;
  letter-spacing: 0.1em;
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}
.bfbtn:hover { color: var(--text); border-color: #3a3a4e; }
.bfbtn.active { color: var(--acid); border-color: rgba(223,255,0,0.3); background: rgba(223,255,0,0.05); }
#board-columns {
  display: flex;
  gap: 0;
  overflow-x: auto;
  overflow-y: hidden;
  flex: 1;
  min-height: 0;
}
.board-col {
  flex: 1;
  min-width: 200px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.board-col:last-child { border-right: none; }
.col-label {
  font-family: 'Fira Code', monospace;
  font-size: 9px;
  letter-spacing: 0.15em;
  color: var(--muted);
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.col-cards {
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}
.col-cards::-webkit-scrollbar { width: 3px; }
.col-cards::-webkit-scrollbar-thumb { background: var(--border); }
/* Board cards */
.bc {
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  position: relative;
}
.bc:hover { border-color: rgba(223,255,0,0.25); background: rgba(223,255,0,0.03); }
.bc.selected { border-color: var(--acid); background: rgba(223,255,0,0.05); }
.bc.breached { border-color: rgba(255,95,95,0.4); }
.bc.breached::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: var(--red);
  border-radius: 6px 0 0 6px;
}
.bc-title {
  font-size: 11px;
  color: var(--text);
  font-weight: 500;
  margin-bottom: 6px;
  line-height: 1.35;
}
.bc-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.bc-status {
  font-family: 'Fira Code', monospace;
  font-size: 9px;
  letter-spacing: 0.08em;
  padding: 2px 6px;
  border-radius: 3px;
  border: 1px solid var(--border);
  color: var(--muted);
}
.bc-status.open { color: var(--acid); border-color: rgba(223,255,0,0.2); }
.bc-status.in_progress { color: #60a5fa; border-color: rgba(96,165,250,0.2); }
.bc-sla {
  font-family: 'Fira Code', monospace;
  font-size: 9px;
  color: var(--muted);
  margin-left: auto;
}
.bc-sla.sla-warn { color: #fbbf24; }
.bc-sla.sla-crit { color: var(--red); animation: slaBlink 1s step-start infinite; }
.bc-sla.sla-breach { color: var(--red); font-weight: 700; }
@keyframes slaBlink { 50% { opacity: 0.3; } }
.bc-actions {
  display: flex;
  gap: 4px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.bc-btn {
  font-family: 'Fira Code', monospace;
  font-size: 8px;
  letter-spacing: 0.08em;
  padding: 3px 8px;
  border-radius: 3px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: all 0.15s;
}
.bc-btn:hover { color: var(--text); border-color: #444456; }
.bc-btn.resolve { color: #4ade80; border-color: rgba(74,222,128,0.2); }
.bc-btn.resolve:hover { background: rgba(74,222,128,0.08); }
.bc-btn.escalate { color: #fb923c; border-color: rgba(251,146,60,0.2); }
.bc-btn.escalate:hover { background: rgba(251,146,60,0.08); }
.bc-btn.map-pin { color: #60a5fa; border-color: rgba(96,165,250,0.2); }
.bc-btn.map-pin:hover { background: rgba(96,165,250,0.08); }

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
  background: rgba(10,10,11,0.82);
  border: 1px solid rgba(0,255,204,0.15);
  border-radius: 10px;
  padding: 20px 32px;
  text-align: center;
  color: var(--muted);
  font-family: 'Fira Code', monospace;
  font-size: 10px;
  letter-spacing: 0.15em;
  pointer-events: none;
  backdrop-filter: blur(6px);
  white-space: nowrap;
}
#map-no-geo .geo-bar {
  display: inline-block;
  width: 4px;
  background: rgba(0,255,204,0.7);
  margin: 0 2px;
  border-radius: 1px;
  animation: geoBarPulse 1s ease-in-out infinite;
}
#map-no-geo .geo-bar:nth-child(1)  { height: 8px;  animation-delay: 0s;   }
#map-no-geo .geo-bar:nth-child(2)  { height: 14px; animation-delay: 0.1s; }
#map-no-geo .geo-bar:nth-child(3)  { height: 6px;  animation-delay: 0.2s; }
#map-no-geo .geo-bar:nth-child(4)  { height: 12px; animation-delay: 0.3s; }
#map-no-geo .geo-bar:nth-child(5)  { height: 5px;  animation-delay: 0.4s; }
#map-no-geo .geo-bar:nth-child(6)  { height: 10px; animation-delay: 0.5s; }
#map-no-geo .geo-bar:nth-child(7)  { height: 7px;  animation-delay: 0.6s; }
#map-no-geo .geo-bar:nth-child(8)  { height: 13px; animation-delay: 0.7s; }
#map-no-geo .geo-bar:nth-child(9)  { height: 4px;  animation-delay: 0.8s; }
#map-no-geo .geo-bar:nth-child(10) { height: 9px;  animation-delay: 0.9s; }
@keyframes geoBarPulse {
  0%, 100% { opacity: 0.15; transform: scaleY(0.4); }
  50%       { opacity: 1;    transform: scaleY(1);   }
}
.wr-layer-switcher {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px;
}
.lyr-btn {
  background: rgba(10,10,11,0.85);
  border: 1px solid rgba(0,255,204,0.15);
  color: #5a5a6e;
  font-family: 'Fira Code', monospace;
  font-size: 9px;
  letter-spacing: 0.12em;
  padding: 5px 10px;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s;
  white-space: nowrap;
  backdrop-filter: blur(4px);
}
.lyr-btn:hover { color: #00ffcc; border-color: rgba(0,255,204,0.4); }
.lyr-btn.active { color: #00ffcc; border-color: rgba(0,255,204,0.5); background: rgba(0,255,204,0.06); }

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
  margin-top: 6px;
  background: transparent;
  color: var(--acid);
  border: 1px solid rgba(223,255,0,0.25);
  border-radius: 4px;
  padding: 5px 10px;
  font-family: 'Fira Code', monospace;
  font-size: 9px;
  font-weight: normal;
  letter-spacing: 0.12em;
  cursor: pointer;
  text-transform: uppercase;
  text-decoration: none;
  text-align: center;
  transition: background 0.15s, border-color 0.15s;
}
.map-popup-btn:hover {
  background: rgba(223,255,0,0.07);
  border-color: rgba(223,255,0,0.5);
  color: var(--acid);
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
      <button class="tab-btn" id="tab-list" onclick="switchTab('list')">LIST</button>
      <button class="tab-btn active" id="tab-map" onclick="switchTab('map')">MAP</button>
    </div>
    <div id="clock">--:--:--</div>
    <button class="wr-mode-btn" onclick="wrCycleMode()" title="Long-press for day" style="background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;letter-spacing:.08em;color:#5a5a6e;touch-action:none;user-select:none"><span id="wr-mode-label">[&#9681;] NITE</span></button>
    <div id="conn-status">● CONNECTING</div>
  </div>
  <div id="view-list">
    <div id="incident-list-wrap">
      <!-- Command board header -->
      <div id="list-header">
        <span id="board-active-count">0 ACTIVE</span>
        <span id="board-breach-count" style="display:none;color:#ff5f5f;font-size:9px;letter-spacing:0.1em"></span>
        <div style="flex:1"></div>
        <!-- Filter rail -->
        <div id="board-filters">
          <button class="bfbtn active" data-f="all" onclick="setBoardFilter('all')">ALL</button>
          <button class="bfbtn" data-f="urgent" onclick="setBoardFilter('urgent')">[!] URGENT</button>
          <button class="bfbtn" data-f="open" onclick="setBoardFilter('open')">OPEN</button>
          <button class="bfbtn" data-f="in_progress" onclick="setBoardFilter('in_progress')">IN PROGRESS</button>
          <button class="bfbtn" data-f="breached" onclick="setBoardFilter('breached')">[×] BREACHED</button>
        </div>
      </div>
      <!-- Board columns -->
      <div id="board-columns">
        <div class="board-col" id="col-urgent">
          <div class="col-label"><span>[!]</span> URGENT</div>
          <div class="col-cards" id="cards-urgent"></div>
        </div>
        <div class="board-col" id="col-high">
          <div class="col-label"><span style="color:#fbbf24">[▲]</span> HIGH</div>
          <div class="col-cards" id="cards-high"></div>
        </div>
        <div class="board-col" id="col-normal">
          <div class="col-label"><span style="color:#5a5a6e">[~]</span> NORMAL</div>
          <div class="col-cards" id="cards-normal"></div>
        </div>
        <div class="board-col" id="col-low">
          <div class="col-label"><span style="color:#3a3a4e">[–]</span> LOW</div>
          <div class="col-cards" id="cards-low"></div>
        </div>
      </div>
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
    <div id="map-no-geo">[+] WAITING FOR GEO DATA<br><span style="display:inline-flex;gap:0;align-items:flex-end;margin-top:10px;height:16px;"><span class="geo-bar"></span><span class="geo-bar"></span><span class="geo-bar"></span><span class="geo-bar"></span><span class="geo-bar"></span><span class="geo-bar"></span><span class="geo-bar"></span><span class="geo-bar"></span><span class="geo-bar"></span><span class="geo-bar"></span></span></div>
    <!-- Capture date filter toolbar -->
    <div id="capture-filter-bar">
      <span style="font-size:9px;letter-spacing:0.1em;color:#555568;font-family:'Fira Code',monospace;">[▲] CAPTURES</span>
      <div id="capture-filter-btns">
        <button class="cfbtn active" data-range="today" onclick="setCaptureRange('today')">TODAY</button>
        <button class="cfbtn" data-range="yesterday" onclick="setCaptureRange('yesterday')">YESTERDAY</button>
        <button class="cfbtn" data-range="week" onclick="setCaptureRange('week')">THIS WEEK</button>
        <button class="cfbtn" data-range="lastweek" onclick="setCaptureRange('lastweek')">LAST WEEK</button>
        <button class="cfbtn" data-range="month" onclick="setCaptureRange('month')">THIS MONTH</button>
        <button class="cfbtn" data-range="lastmonth" onclick="setCaptureRange('lastmonth')">LAST MONTH</button>
        <button class="cfbtn" data-range="3mo" onclick="setCaptureRange('3mo')">3 MONTHS</button>
        <button class="cfbtn" data-range="custom" onclick="setCaptureRange('custom')">CUSTOM</button>
        <button class="cfbtn" style="border-color:#ff5f5f44;color:#ff5f5f88;" onclick="clearCaptures()">[×] CLEAR</button>
      </div>
      <div id="capture-filter-custom" style="display:none;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap;">
        <input type="date" id="cfrom" style="background:#111114;border:1px solid #2a2a36;color:#e8e8ea;font-family:'Fira Code',monospace;font-size:10px;padding:3px 6px;border-radius:4px;">
        <span style="color:#555568;font-size:10px;">→</span>
        <input type="date" id="cto" style="background:#111114;border:1px solid #2a2a36;color:#e8e8ea;font-family:'Fira Code',monospace;font-size:10px;padding:3px 6px;border-radius:4px;">
        <button class="cfbtn" onclick="applyCaptureCustomRange()">[→] APPLY</button>
      </div>
      <div id="capture-filter-count" style="font-size:9px;font-family:'Fira Code',monospace;color:#555568;margin-top:4px;"></div>
    </div>
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
  let currentTab = 'map';
  let mapInitialized = false;
  window.switchTab = function(tab) {
    currentTab = tab;
    document.getElementById('view-list').style.display = tab === 'list' ? 'flex' : 'none';
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

  let _boardFilter = 'all';
  window.setBoardFilter = function(f) {
    _boardFilter = f;
    document.querySelectorAll('.bfbtn').forEach(b => b.classList.toggle('active', b.dataset.f === f));
    renderList();
  };

  function renderList() {
    const empty = document.getElementById('empty-board');
    const countEl = document.getElementById('incident-count');
    const boardCount = document.getElementById('board-active-count');
    const boardBreach = document.getElementById('board-breach-count');

    let active = incidents.filter(i => i.status === 'open' || i.status === 'in_progress');
    const totalActive = active.length;
    const totalBreached = active.filter(i => i.sla_status === 'breached').length;

    countEl.textContent = totalActive + ' ACTIVE';
    if (boardCount) boardCount.textContent = totalActive + ' ACTIVE';
    if (boardBreach) {
      boardBreach.style.display = totalBreached > 0 ? '' : 'none';
      boardBreach.textContent = '[×] ' + totalBreached + ' BREACHED';
    }

    // Apply filter
    if (_boardFilter === 'urgent') active = active.filter(i => i.priority === 'urgent');
    else if (_boardFilter === 'open') active = active.filter(i => i.status === 'open');
    else if (_boardFilter === 'in_progress') active = active.filter(i => i.status === 'in_progress');
    else if (_boardFilter === 'breached') active = active.filter(i => i.sla_status === 'breached');

    const cols = { urgent: [], high: [], normal: [], low: [] };
    for (const inc of active) cols[inc.priority || 'normal']?.push(inc) || cols.normal.push(inc);

    if (!totalActive) {
      document.getElementById('board-columns').style.display = 'none';
      empty.style.display = 'flex';
      return;
    }
    document.getElementById('board-columns').style.display = 'flex';
    empty.style.display = 'none';

    for (const [priority, list] of Object.entries(cols)) {
      const container = document.getElementById('cards-' + priority);
      if (!container) continue;
      container.innerHTML = '';
      for (const inc of list) {
        const id = String(inc.Id);
        const rem = slaRemaining(inc);
        const sc = slaClass(inc);
        const slaText = rem !== null ? fmtDuration(rem) : '--';
        const isBreached = inc.sla_status === 'breached';
        const hasGeo = inc.lat != null && inc.lng != null;

        const card = document.createElement('div');
        card.className = 'bc' + (isBreached ? ' breached' : '') + (id === selectedId ? ' selected' : '');
        card.dataset.id = id;
        card.innerHTML =
          '<div class="bc-title">' + escHtml(inc.title || 'Untitled') + '</div>' +
          '<div class="bc-meta">' +
            '<span class="bc-status ' + inc.status + '">' + (inc.status === 'in_progress' ? 'IN PROGRESS' : 'OPEN') + '</span>' +
            '<span class="bc-sla ' + sc + '" data-sla-id="' + id + '">' + (isBreached ? '[×] BREACHED' : slaText) + '</span>' +
          '</div>' +
          '<div class="bc-actions">' +
            '<button class="bc-btn" onclick="event.stopPropagation();selectIncident(' + JSON.stringify(id) + ')">DETAILS</button>' +
            (hasGeo ? '<button class="bc-btn map-pin" onclick="event.stopPropagation();flyToIncident(' + JSON.stringify(id) + ')">MAP</button>' : '') +
            (inc.status !== 'in_progress' ? '<button class="bc-btn escalate" onclick="event.stopPropagation();quickEscalate(' + JSON.stringify(id) + ')">ESCALATE</button>' : '') +
            '<button class="bc-btn resolve" onclick="event.stopPropagation();quickResolve(' + JSON.stringify(id) + ')">RESOLVE</button>' +
          '</div>';

        card.addEventListener('click', () => selectIncident(id));
        container.appendChild(card);
      }
      if (!list.length) {
        container.innerHTML = '<div style="color:#2a2a36;font-family:monospace;font-size:9px;letter-spacing:0.1em;padding:8px 4px">— NONE —</div>';
      }
    }
  }

  window.flyToIncident = function(id) {
    const inc = incidents.find(i => String(i.Id) === id);
    if (!inc || inc.lat == null) return;
    switchTab('map');
    setTimeout(() => leafletMap && leafletMap.flyTo([inc.lat, inc.lng], 14, { duration: 1.2 }), 100);
  };

  window.quickEscalate = async function(id) {
    const inc = incidents.find(i => String(i.Id) === id);
    if (!inc) return;
    const res = await apiFetch('/v1/incidents/' + id, { method: 'PATCH', body: JSON.stringify({ priority: 'urgent' }) });
    if (res?.ok) { inc.priority = 'urgent'; renderList(); toast('[!] Escalated to URGENT', 'warn'); }
    else toast('Escalate failed', 'err');
  };

  window.quickResolve = async function(id) {
    if (!confirm('Mark this incident as resolved?')) return;
    const res = await apiFetch('/v1/incidents/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) });
    if (res?.ok) {
      const idx = incidents.findIndex(i => String(i.Id) === id);
      if (idx !== -1) incidents[idx].status = 'resolved';
      renderList();
      removeIncidentMarker(id);
      toast('[✓] Incident resolved', 'ok');
    } else toast('Resolve failed', 'err');
  };

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
  let activeLayer = 'dark';
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

  function markerStyleForLayer(layerName) {
    if (layerName === 'satellite' || layerName === 'hybrid') {
      return { radiusBoost: 2, weight: 3, fillOpacity: 0.98, stroke: '#ffffff', strokeOpacity: 0.95 };
    }
    if (layerName === 'terrain') {
      return { radiusBoost: 1, weight: 3, fillOpacity: 0.94, stroke: '#0a0a0b', strokeOpacity: 0.9 };
    }
    return { radiusBoost: 0, weight: 2, fillOpacity: 0.85, stroke: null, strokeOpacity: 0 };
  }

  function refreshIncidentMarkers() {
    if (!leafletMap) return;
    for (const marker of incidentMarkers.values()) leafletMap.removeLayer(marker);
    incidentMarkers.clear();
    const withGeo = incidents.filter(i =>
      (i.status === 'open' || i.status === 'in_progress') &&
      i.lat != null && i.lng != null);
    for (const inc of withGeo) addIncidentMarker(inc);
  }

  function initMap() {
    leafletMap = L.map('map-container', {
      zoomControl: true,
      attributionControl: false,
    }).setView([37.8, -96], 4); // Default: CONUS

    // ── Tile layers ────────────────────────────────────────────────────
    const tileLayers = {
      default: [
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
          subdomains: 'abcd', maxZoom: 19,
        }),
      ],
      dark: [
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
          subdomains: 'abcd', maxZoom: 19,
        }),
      ],
      hybrid: [
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19,
        }),
        L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19,
          pane: 'overlayPane',
        }),
      ],
      terrain: [
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19,
        }),
      ],
      satellite: [
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19,
        }),
      ],
    };
    activeLayer = 'dark';
    tileLayers.dark.forEach(layer => layer.addTo(leafletMap));

    // ── Layer switcher ─────────────────────────────────────────────────
    const layerSwitcher = L.control({ position: 'topright' });
    layerSwitcher.onAdd = function() {
      const div = L.DomUtil.create('div', 'wr-layer-switcher');
      div.innerHTML = \`
        <button class="lyr-btn active" data-lyr="dark" onclick="setMapLayer('dark')">DARK</button>
        <button class="lyr-btn" data-lyr="default" onclick="setMapLayer('default')">DEFAULT</button>
        <button class="lyr-btn" data-lyr="hybrid" onclick="setMapLayer('hybrid')">HYBRID</button>
        <button class="lyr-btn" data-lyr="terrain" onclick="setMapLayer('terrain')">TERRAIN</button>
        <button class="lyr-btn" data-lyr="satellite" onclick="setMapLayer('satellite')">SATELLITE</button>
      \`;
      L.DomEvent.disableClickPropagation(div);
      return div;
    };
    layerSwitcher.addTo(leafletMap);

    window.setMapLayer = function(name) {
      if (name === activeLayer || !tileLayers[name]) return;
      tileLayers[activeLayer].forEach(layer => leafletMap.removeLayer(layer));
      tileLayers[name].forEach(layer => layer.addTo(leafletMap));
      tileLayers[name][0].bringToBack();
      activeLayer = name;
      refreshIncidentMarkers();
      document.querySelectorAll('.lyr-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.lyr === name));
    };

    // ── Mini-map inset ─────────────────────────────────────────────────
    const miniMapLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 19,
    });
    const miniMap = L.control({ position: 'bottomright' });
    miniMap.onAdd = function() {
      const wrap = L.DomUtil.create('div', 'wr-minimap-wrap');
      wrap.id = 'minimap-container';
      wrap.style.cssText = 'width:160px;height:110px;border:1px solid rgba(0,255,204,0.2);border-radius:6px;overflow:hidden;';
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation(wrap);
      return wrap;
    };
    miniMap.addTo(leafletMap);
    // Init mini-map after container exists
    setTimeout(() => {
      const miniMapEl = document.getElementById('minimap-container');
      if (!miniMapEl) return;
      const mm = L.map('minimap-container', {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
      }).setView(leafletMap.getCenter(), Math.max(1, leafletMap.getZoom() - 5));
      miniMapLayer.addTo(mm);
      // Track main map movement
      leafletMap.on('move', () => mm.setView(leafletMap.getCenter(), Math.max(1, leafletMap.getZoom() - 5)));
      // View indicator rectangle
      const viewRect = L.rectangle(leafletMap.getBounds(), {
        color: '#00ffcc', weight: 1, fillOpacity: 0.08, interactive: false,
      }).addTo(mm);
      leafletMap.on('moveend zoomend', () => viewRect.setBounds(leafletMap.getBounds()));
    }, 200);

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

    // Recluster captures on zoom change
    leafletMap.on('zoomend', onMapZoomEnd);

    // Right-click on map → clear all captures from map
    leafletMap.on('contextmenu', () => clearCaptures());

    // Load today's captures by default
    const { since } = getCaptureRangeDates('today');
    loadHistoricalSignals(since);
  }

  function makeCircleMarker(inc) {
    const color = markerColor(inc);
    const layerStyle = markerStyleForLayer(activeLayer);
    const radius = (inc.priority === 'urgent' ? 14 : 10) + layerStyle.radiusBoost;
    const marker = L.circleMarker([inc.lat, inc.lng], {
      radius,
      color: layerStyle.stroke || color,
      opacity: layerStyle.strokeOpacity || 1,
      fillColor: color,
      fillOpacity: layerStyle.fillOpacity,
      weight: layerStyle.weight,
    });

    // For urgent: add CSS pulse via custom pane/className trick
    // We use a divIcon wrapper for urgent
    if (inc.priority === 'urgent') {
      const borderColor = layerStyle.stroke || '#ff6666';
      const shadow = activeLayer === 'satellite' || activeLayer === 'hybrid'
        ? '0 0 0 3px rgba(255,255,255,0.55), 0 0 18px rgba(255,51,51,0.45)'
        : activeLayer === 'terrain'
          ? '0 0 0 3px rgba(10,10,11,0.45), 0 0 16px rgba(255,51,51,0.38)'
          : '0 0 12px rgba(255,51,51,0.35)';
      const icon = L.divIcon({
        className: '',
        html: '<div class="marker-urgent" style="width:22px;height:22px;border-radius:50%;background:#ff3333;border:3px solid ' + borderColor + ';box-shadow:' + shadow + ';opacity:0.96"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
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
    const hasIncidents = incidentMarkers.size > 0;
    const hasBeacons = beaconMarkers.size > 0;
    const hasCaptures = (_captures || []).length > 0;
    document.getElementById('map-no-geo').style.display =
      (hasIncidents || hasBeacons || hasCaptures) ? 'none' : 'block';
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

  // ── Beacon track polylines ─────────────────────────────────────────
  // _beaconTracks[key] = { points: [[lat,lng],...], polyline: L.Polyline, visible: true }
  const _beaconTracks = {};
  const MAX_TRACK_POINTS = 500; // per device

  function getTrackColor(key) {
    // Deterministic color per device — cycle through distinct hues
    const palette = ['#00ffcc','#a78bfa','#fbbf24','#60a5fa','#f472b6','#34d399','#fb923c'];
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffff;
    return palette[h % palette.length];
  }

  function pushTrackPoint(key, lat, lng) {
    if (!leafletMap) return;
    if (!_beaconTracks[key]) {
      const color = getTrackColor(key);
      _beaconTracks[key] = {
        points: [],
        color,
        polyline: L.polyline([], {
          color,
          weight: 2,
          opacity: 0.7,
          dashArray: '4 6',
          smoothFactor: 1,
        }).addTo(leafletMap),
      };
    }
    const track = _beaconTracks[key];
    track.points.push([lat, lng]);
    if (track.points.length > MAX_TRACK_POINTS) track.points.shift();
    track.polyline.setLatLngs(track.points);
  }

  function clearTrack(key) {
    if (_beaconTracks[key]) {
      leafletMap && leafletMap.removeLayer(_beaconTracks[key].polyline);
      delete _beaconTracks[key];
    }
  }

  function toggleTrack(key) {
    const t = _beaconTracks[key];
    if (!t) return;
    if (leafletMap.hasLayer(t.polyline)) {
      leafletMap.removeLayer(t.polyline);
    } else {
      t.polyline.addTo(leafletMap);
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

        // Dot — color matches track (deterministic per device)
    const shortId = String(deviceId || userId).slice(-6);
    const displayLabel = label || shortId;
    const dotColor = getTrackColor(key);
    const icon = L.divIcon({
      className: '',
      html: \`<div style="
        width:14px;height:14px;border-radius:50%;
        background:\${dotColor};border:2px solid \${dotColor}99;
        box-shadow:0 0 8px \${dotColor}bb;
        animation:beaconPing 2s ease-out infinite;
      "></div>\`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    const marker = L.marker([lat, lng], { icon }).addTo(leafletMap);
        // Label marker (floating text above dot)
    const labelIcon = L.divIcon({
      className: '',
      html: \`<div style="font-family:'Fira Code',monospace;font-size:9px;color:\${dotColor};letter-spacing:0.08em;white-space:nowrap;text-shadow:0 0 4px rgba(0,0,0,0.9);margin-top:-18px;margin-left:8px;">\${displayLabel}</div>\`,
      iconSize: [80, 14],
      iconAnchor: [0, 14],
    });
    const labelMarker = L.marker([lat, lng], { icon: labelIcon, interactive: false }).addTo(leafletMap);

    beaconMarkers.set(key, { marker, accuracyCircle, labelMarker, lastSeen: Date.now(), userId, lat, lng, deviceId });

    // Track polyline — push point every ping
    pushTrackPoint(key, lat, lng);

    // Match beacon dot color to track color
    const trackColor = (_beaconTracks[key]?.color) || '#00ffcc';

    // Update popup with track info
    marker.bindPopup(\`
      <div class="map-popup-title">[+] Beacon Active</div>
      <div class="map-popup-row">Device <span>\${displayLabel}</span></div>
      <div class="map-popup-row">Coords <span>\${lat.toFixed(5)}, \${lng.toFixed(5)}</span></div>
      \${accuracy ? \`<div class="map-popup-row">Accuracy <span>±\${Math.round(accuracy)}m</span></div>\` : ''}
      <div class="map-popup-row">Track pts <span>\${(_beaconTracks[key]?.points?.length || 1)}</span></div>
      <a class="map-popup-btn" onclick="toggleTrack(\${JSON.stringify(key)});return false;" href="#">[~] TOGGLE TRACK</a>
      <a class="map-popup-btn" style="color:#ff5f5f88;border-color:#ff5f5f22;" onmouseover="this.style.background='rgba(255,95,95,0.07)'" onmouseout="this.style.background='transparent'" onclick="clearTrack(\${JSON.stringify(key)});return false;" href="#">[×] CLEAR TRACK</a>
    \`);

    updateBeaconPanel();
    checkGeoEmpty();
  }

  function removeBeaconDot(deviceId, userId) {
    const key = String(deviceId || ('user-' + userId));
    const existing = beaconMarkers.get(key);
    if (!existing) return;
    leafletMap && leafletMap.removeLayer(existing.marker);
    existing.accuracyCircle && leafletMap && leafletMap.removeLayer(existing.accuracyCircle);
    existing.labelMarker && leafletMap && leafletMap.removeLayer(existing.labelMarker);
    beaconMarkers.delete(key);
    clearTrack(key);
    updateBeaconPanel();
    checkGeoEmpty();
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
  async function loadHistoricalSignals(since, before) {
    try {
      let url = '/v1/signals?type=capture&limit=500&sort=-Id&api_key=' + encodeURIComponent(_apiKey);
      if (since) url += '&since=' + encodeURIComponent(since);
      if (before) url += '&before=' + encodeURIComponent(before);
      const res = await fetch(url);
      if (!res.ok) return;
      const { signals = [] } = await res.json();

      // Clear existing captures and recluster
      _captures.length = 0;
      _clusterMarkers.forEach(m => leafletMap.removeLayer(m));
      _clusterMarkers = [];
      clearSpider();

      const captures = signals.filter(s => s.lat != null);
      for (const c of captures) {
        let meta = {};
        try { meta = JSON.parse(c.meta || '{}'); } catch {}
        const deviceId = meta.device_id || ('user-' + c.user_id);
        const ts = c.created_at || c.CreatedAt || new Date().toISOString();
        _captures.push({
          lat: +c.lat,
          lng: +c.lng,
          deviceId,
          shortId: deviceId.slice(-8),
          hasImage: !!(c.image_url),
          imgSrc: c.image_url ? (c.image_url.startsWith('/') ? c.image_url : '/captures/' + c.image_url.split('/').pop()) : null,
          ts,
          timeStr: new Date(ts).toISOString().slice(11,19) + ' UTC',
          dateStr: new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          historical: true,
        });
      }

      // Update count badge
      const countEl = document.getElementById('capture-filter-count');
      if (countEl) countEl.textContent = captures.length ? \`\${captures.length} capture\${captures.length === 1 ? '' : 's'}\` : 'no captures in range';

      if (_captures.length > 0) {
        document.getElementById('map-no-geo').style.display = 'none';
        rebuildCaptureClusters();
        const bounds = _captures.map(c => [c.lat, c.lng]);
        if (bounds.length === 1) {
          leafletMap.setView(bounds[0], 14);
        } else {
          leafletMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
        }
      } else if (!incidents.some(i => i.lat != null)) {
        document.getElementById('map-no-geo').style.display = 'block';
      }
    } catch (e) { console.warn('historical signals load failed', e); }
  }

  // ── Capture date filter ───────────────────────────────────────────
  let _activeCaptureRange = 'today';

  function getCaptureRangeDates(range) {
    const now = new Date();
    const startOfDay = d => { const r = new Date(d); r.setUTCHours(0,0,0,0); return r; };
    switch (range) {
      case 'today':
        return { since: startOfDay(now).toISOString() };
      case 'yesterday': {
        const s = startOfDay(now); s.setUTCDate(s.getUTCDate() - 1);
        const e = startOfDay(now);
        return { since: s.toISOString(), before: e.toISOString() };
      }
      case 'week': {
        const s = startOfDay(now); s.setUTCDate(s.getUTCDate() - s.getUTCDay());
        return { since: s.toISOString() };
      }
      case 'lastweek': {
        const s = startOfDay(now); s.setUTCDate(s.getUTCDate() - s.getUTCDay() - 7);
        const e = startOfDay(now); e.setUTCDate(e.getUTCDate() - e.getUTCDay());
        return { since: s.toISOString(), before: e.toISOString() };
      }
      case 'month': {
        const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        return { since: s.toISOString() };
      }
      case 'lastmonth': {
        const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        const e = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        return { since: s.toISOString(), before: e.toISOString() };
      }
      case '3mo': {
        const s = new Date(now); s.setUTCMonth(s.getUTCMonth() - 3);
        return { since: s.toISOString() };
      }
      default:
        return {};
    }
  }

  function clearCaptures() {
    _captures.length = 0;
    _clusterMarkers.forEach(m => leafletMap.removeLayer(m));
    _clusterMarkers = [];
    clearSpider();
    document.querySelectorAll('.cfbtn').forEach(b => b.classList.remove('active'));
    const countEl = document.getElementById('capture-filter-count');
    if (countEl) countEl.textContent = '';
    checkGeoEmpty();
  }

  function setCaptureRange(range) {
    _activeCaptureRange = range;
    document.querySelectorAll('.cfbtn').forEach(b => b.classList.toggle('active', b.dataset.range === range));
    const customEl = document.getElementById('capture-filter-custom');
    if (customEl) customEl.style.display = range === 'custom' ? 'flex' : 'none';
    if (range !== 'custom') {
      const { since, before } = getCaptureRangeDates(range);
      loadHistoricalSignals(since, before);
    }
  }

  function applyCaptureCustomRange() {
    const from = document.getElementById('cfrom').value;
    const to = document.getElementById('cto').value;
    if (!from) return;
    // Enforce 3-month max
    const fromDate = new Date(from);
    const toDate = to ? new Date(to + 'T23:59:59Z') : new Date();
    const maxBack = new Date(toDate); maxBack.setUTCMonth(maxBack.getUTCMonth() - 3);
    const clampedFrom = fromDate < maxBack ? maxBack : fromDate;
    loadHistoricalSignals(clampedFrom.toISOString(), to ? toDate.toISOString() : undefined);
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


  // ── Capture Cluster + Spider System ──────────────────────────────────
  const _captures = []; // all capture records
  let _clusterMarkers = []; // active cluster/solo markers on map
  let _spiderLines = [];    // active SVG spider lines
  let _spiderMarkers = [];  // active spider arm markers
  let _spiderOpen = false;

  function addCapturePin(payload, deviceId, historical) {
    if (!leafletMap || payload.lat == null || payload.lng == null) return;
    const ts = payload.created_at || payload.CreatedAt || new Date().toISOString();
    _captures.push({
      lat: +payload.lat,
      lng: +payload.lng,
      deviceId: deviceId || '',
      shortId: (deviceId || '').slice(-8),
      hasImage: !!(payload.image_url),
      imgSrc: payload.image_url ? (payload.image_url.startsWith('/') ? payload.image_url : '/captures/' + payload.image_url.split('/').pop()) : null,
      ts,
      timeStr: new Date(ts).toISOString().slice(11,19) + ' UTC',
      dateStr: new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      historical: !!historical,
    });
    rebuildCaptureClusters();
  }

  function clearSpider() {
    _spiderLines.forEach(l => leafletMap.removeLayer(l));
    _spiderMarkers.forEach(m => leafletMap.removeLayer(m));
    _spiderLines = [];
    _spiderMarkers = [];
    _spiderOpen = false;
  }

  function rebuildCaptureClusters() {
    // Remove existing cluster/solo markers
    _clusterMarkers.forEach(m => leafletMap.removeLayer(m));
    _clusterMarkers = [];
    clearSpider();

    if (_captures.length === 0) return;

    // Group captures by proximity in pixel space at current zoom
    const CLUSTER_PX = 44;
    const used = new Array(_captures.length).fill(false);
    const groups = [];

    for (let i = 0; i < _captures.length; i++) {
      if (used[i]) continue;
      const group = [i];
      used[i] = true;
      const piPt = leafletMap.latLngToContainerPoint([_captures[i].lat, _captures[i].lng]);
      for (let j = i + 1; j < _captures.length; j++) {
        if (used[j]) continue;
        const pjPt = leafletMap.latLngToContainerPoint([_captures[j].lat, _captures[j].lng]);
        const dx = piPt.x - pjPt.x, dy = piPt.y - pjPt.y;
        if (Math.sqrt(dx*dx + dy*dy) < CLUSTER_PX) {
          group.push(j);
          used[j] = true;
        }
      }
      groups.push(group);
    }

    for (const group of groups) {
      if (group.length === 1) {
        // Solo pin
        const c = _captures[group[0]];
        const m = makeSoloCaptureMarker(c);
        m.addTo(leafletMap);
        _clusterMarkers.push(m);
      } else {
        // Cluster node — pulsing dot, shows count
        const lats = group.map(i => _captures[i].lat);
        const lngs = group.map(i => _captures[i].lng);
        const cLat = lats.reduce((a,b)=>a+b,0)/lats.length;
        const cLng = lngs.reduce((a,b)=>a+b,0)/lngs.length;
        const count = group.length;
        const icon = L.divIcon({
          className: '',
          html: \`<div style="width:26px;height:26px;border-radius:50%;background:rgba(139,92,246,0.85);border:2px solid #a78bfa;display:flex;align-items:center;justify-content:center;font-family:'Fira Code',monospace;font-size:10px;font-weight:700;color:#fff;box-shadow:0 0 12px rgba(139,92,246,0.7),0 0 24px rgba(139,92,246,0.3);cursor:pointer;animation:clusterPulse 2.4s ease-in-out infinite;">\${count}</div>\`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        const cm = L.marker([cLat, cLng], { icon, zIndexOffset: 100 }).addTo(leafletMap);
        cm._captureGroup = group;
        cm._clustered = true;
        cm.on('click', function(e) {
          L.DomEvent.stopPropagation(e);
          if (_spiderOpen) { clearSpider(); return; }
          spiderOpen(group, [cLat, cLng], cm);
        });
        _clusterMarkers.push(cm);
      }
    }
  }

  function spiderOpen(group, center, clusterMarker) {
    clearSpider();
    _spiderOpen = true;
    const count = group.length;
    // Distribute arms in a circle; radius grows with count
    const radius = Math.max(80, count * 22);
    const angleStep = (2 * Math.PI) / count;

    group.forEach((captureIdx, armIdx) => {
      const c = _captures[captureIdx];
      const angle = -Math.PI/2 + armIdx * angleStep; // start at top

      // Convert center to pixel, compute arm endpoint in pixels
      const centerPx = leafletMap.latLngToContainerPoint(center);
      const endPx = L.point(
        centerPx.x + Math.cos(angle) * radius,
        centerPx.y + Math.sin(angle) * radius
      );
      const endLatLng = leafletMap.containerPointToLatLng(endPx);

      // SVG connector line
      const line = L.polyline([center, endLatLng], {
        color: '#a78bfa',
        weight: 1,
        opacity: 0.45,
        dashArray: '3,4',
      }).addTo(leafletMap);
      _spiderLines.push(line);

      // Arm marker (mini capture pin)
      const icon = L.divIcon({
        className: '',
        html: \`<div style="width:20px;height:20px;border-radius:3px;background:#8b5cf6;border:2px solid #a78bfa;display:flex;align-items:center;justify-content:center;font-size:9px;font-family:monospace;font-weight:700;color:#e8e8ea;box-shadow:0 0 8px rgba(139,92,246,0.6);cursor:pointer;animation:spiderArmIn 0.18s ease-out \${armIdx * 0.04}s both;">&#9650;</div>\`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      const arm = L.marker(endLatLng, { icon, zIndexOffset: 200 }).addTo(leafletMap);

      arm.on('click', function(e) {
        L.DomEvent.stopPropagation(e);
        openCapturePopup(c, arm);
      });
      _spiderMarkers.push(arm);
    });

    // Close spider when map is clicked
    leafletMap.once('click', clearSpider);
  }

  function makeSoloCaptureMarker(c) {
    const icon = L.divIcon({
      className: '',
      html: \`<div style="width:22px;height:22px;border-radius:3px;background:#8b5cf6;border:2px solid #a78bfa;display:flex;align-items:center;justify-content:center;font-size:11px;font-family:monospace;font-weight:700;color:#e8e8ea;box-shadow:0 0 10px rgba(139,92,246,0.6);\${c.historical ? 'opacity:0.75' : ''}">&#9650;</div>\`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    const m = L.marker([c.lat, c.lng], { icon });
    m.on('click', function(e) {
      L.DomEvent.stopPropagation(e);
      openCapturePopup(c, m);
    });
    return m;
  }

  function openCapturePopup(c, marker) {
    const coords = \`\${c.lat.toFixed(5)}, \${c.lng.toFixed(5)}\`;
    let html = \`<div class="map-popup-title" style="color:#a78bfa">[▲] Capture</div>
      <div class="map-popup-row">Device <span>\${escHtml(c.shortId)}</span></div>
      <div class="map-popup-row">Time <span>\${c.dateStr} \${c.timeStr}</span></div>
      <div class="map-popup-row">Coords <span>\${coords}</span></div>\`;
    if (c.hasImage && c.imgSrc) {
      const meta = \`\${c.shortId} · \${c.dateStr} \${c.timeStr} · \${coords}\`;
      html += \`<div style="margin-top:10px;cursor:pointer;position:relative;" onclick="showCaptureLightbox('\${c.imgSrc}', '\${escHtml(meta)}')">
        <img src="\${c.imgSrc}" style="width:100%;max-width:240px;border-radius:4px;border:1px solid rgba(167,139,250,0.3);display:block;" onerror="this.style.display='none';this.nextSibling.style.display='block'">
        <div style="display:none;padding:8px;background:#1a1020;border:1px dashed #a78bfa;border-radius:4px;font-size:11px;color:#a78bfa;">[▲] Image unavailable</div>
        <div style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.7);border-radius:3px;padding:2px 5px;font-size:9px;color:#a78bfa;font-family:monospace">[→] EXPAND</div>
      </div>\`;
    }
    marker.bindPopup(L.popup({ maxWidth: 280 }).setContent(html)).openPopup();
  }

  // Recluster when zoom changes
  function onMapZoomEnd() {
    if (_captures.length > 0) rebuildCaptureClusters();
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
  // Default to map view — init on next tick so DOM has laid out
  mapInitialized = true;
  setTimeout(() => initMap(), 50);
  window.setCaptureRange = setCaptureRange;
  window.applyCaptureCustomRange = applyCaptureCustomRange;
  window.clearCaptures = clearCaptures;
  window.toggleTrack = toggleTrack;
  window.clearTrack = clearTrack;
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
/* -- Capture filter bar -- */
#capture-filter-bar {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  background: rgba(10,10,11,0.92);
  border: 1px solid rgba(139,92,246,0.25);
  border-radius: 10px;
  padding: 8px 12px;
  backdrop-filter: blur(8px);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 320px;
  max-width: 90vw;
}
#capture-filter-btns { display: flex; gap: 4px; flex-wrap: wrap; }
.cfbtn {
  background: transparent;
  border: 1px solid #2a2a36;
  color: #555568;
  font-family: 'Fira Code', monospace;
  font-size: 9px;
  letter-spacing: 0.08em;
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}
.cfbtn:hover { border-color: #a78bfa; color: #a78bfa; }
.cfbtn.active { border-color: #a78bfa; color: #a78bfa; background: rgba(139,92,246,0.12); }
@keyframes clusterPulse {
  0%, 100% { box-shadow: 0 0 12px rgba(139,92,246,0.7), 0 0 24px rgba(139,92,246,0.3); transform: scale(1); }
  50% { box-shadow: 0 0 18px rgba(139,92,246,0.9), 0 0 36px rgba(139,92,246,0.4); transform: scale(1.08); }
}
@keyframes spiderArmIn {
  from { opacity: 0; transform: scale(0.4); }
  to { opacity: 1; transform: scale(1); }
}
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
