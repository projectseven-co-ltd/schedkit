// Serves the public booking page UI
// GET /book/:username/:event_slug

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';

export default async function bookingPageRoutes(fastify) {
  fastify.get('/book/:username/:event_slug', async (req, reply) => {
    const { username, event_slug } = req.params;
    const { reschedule, name, email, tz, nobranding } = req.query;

    // Only hide branding if requested AND the user is on a paid plan
    let hideBranding = false;
    if (nobranding === '1') {
      try {
        const result = await db.find(tables.users, `(slug,eq,${username})`);
        const user = result?.list?.[0];
        if (user && user.plan && user.plan !== 'free') {
          hideBranding = true;
        }
      } catch { /* fail open — show branding */ }
    }

    const html = buildPage(username, event_slug, { reschedule, name, email, tz, hideBranding });
    reply.type('text/html').send(html);
  });
}

function buildPage(username, eventSlug, { reschedule, name, email, tz, hideBranding = false } = {}) {
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

/* ── PAGE SHELL ── */
.page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
}

/* ── CARD ── */
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

/* ── MAIN AREA (info + picker) ── */
.card-body {
  display: flex;
  min-height: 480px;
}

/* ── INFO PANEL ── */
.info-panel {
  width: 240px;
  flex-shrink: 0;
  padding: 32px 28px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 0;
}
.info-avatar {
  width: 44px; height: 44px;
  border-radius: 50%;
  background: var(--surface2);
  border: 1px solid var(--border2);
  display: flex; align-items: center; justify-content: center;
  font-size: 20px;
  margin-bottom: 12px;
  flex-shrink: 0;
}
.info-name {
  font-size: 13px;
  color: var(--text2);
  margin-bottom: 4px;
  font-weight: 500;
}
.info-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.2;
  margin-bottom: 16px;
}
.info-meta {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}
.meta-row {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
  color: var(--text2);
}
.meta-icon {
  font-size: 14px;
  flex-shrink: 0;
  opacity: 0.7;
}
.info-desc {
  font-size: 12px;
  color: var(--text2);
  line-height: 1.65;
  border-top: 1px solid var(--border);
  padding-top: 14px;
  margin-top: 4px;
}
.reschedule-badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 10px; font-family: var(--font-mono);
  color: var(--accent); background: var(--accent-dim);
  border: 1px solid var(--accent); border-radius: 20px;
  padding: 3px 9px; margin-top: 12px;
}
.info-spacer { flex: 1; }
.info-footer {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.lights-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: 20px;
  border: 1px solid var(--border2); background: transparent;
  color: var(--text2); font-family: var(--font-mono);
  font-size: 10px; letter-spacing: 0.07em;
  cursor: pointer; transition: all .18s;
}
.lights-btn:hover { border-color: var(--accent); color: var(--accent); }

/* ── PICKER AREA ── */
.picker-area {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}

/* ── CALENDAR PANEL ── */
.cal-panel {
  flex: 1;
  padding: 32px 28px;
  min-width: 0;
}
.cal-heading {
  font-size: 11px; font-family: var(--font-mono);
  color: var(--muted); letter-spacing: 0.1em;
  text-transform: uppercase; margin-bottom: 20px;
}
.cal-nav {
  display: flex; align-items: center;
  justify-content: space-between; margin-bottom: 20px;
}
.cal-nav-btn {
  background: none; border: 1px solid var(--border2);
  color: var(--text); width: 34px; height: 34px;
  border-radius: 8px; cursor: pointer; font-size: 17px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.cal-nav-btn:hover { border-color: var(--accent); color: var(--accent); }
.cal-month { font-weight: 700; font-size: 17px; }
.cal-month span { color: var(--text2); font-weight: 400; margin-left: 6px; }
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 5px;
}
.cal-dow {
  font-size: 11px; color: var(--text2);
  text-align: center; padding: 0 0 8px;
  font-family: var(--font-sans); font-weight: 500;
}
.cal-day {
  aspect-ratio: 1;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 500;
  border-radius: var(--r-day);
  cursor: pointer;
  transition: background 0.12s, color 0.12s, transform 0.1s;
  border: none; background: transparent;
  position: relative; color: var(--text2);
  user-select: none;
}
.cal-day.empty { cursor: default; }
.cal-day.disabled { color: var(--muted); opacity: 0.35; cursor: default; }
.cal-day.today { color: var(--text); font-weight: 700; }
.cal-day.today::after {
  content: '';
  position: absolute; bottom: 5px; left: 50%; transform: translateX(-50%);
  width: 3px; height: 3px; border-radius: 50%; background: var(--accent);
}
.cal-day.has-slots {
  background: var(--day-avail);
  color: var(--text);
}
.cal-day.has-slots:hover:not(.selected):not(.disabled) {
  background: var(--day-avail-hover);
  transform: scale(1.08);
}
.cal-day.selected {
  background: var(--accent) !important;
  color: var(--accent-fg) !important;
  font-weight: 700;
  transform: scale(1.08);
}
.cal-day.selected::after { display: none; }

/* ── TZ ROW ── */
.tz-row {
  margin-top: 20px;
  display: flex; align-items: center; gap: 8px;
}
.tz-globe { font-size: 14px; color: var(--text2); flex-shrink: 0; }
.tz-select {
  background: transparent;
  border: none; color: var(--text2);
  font-family: var(--font-sans); font-size: 13px;
  cursor: pointer; padding: 0; flex: 1;
  appearance: none; -webkit-appearance: none;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 220px;
}
.tz-select:focus { outline: none; }
.tz-chevron { font-size: 10px; color: var(--text2); }

/* ── SLOTS PANEL ── */
.slots-panel {
  width: 0;
  overflow: hidden;
  border-left: 1px solid transparent;
  transition: width 0.32s cubic-bezier(0.4,0,0.2,1),
              border-color 0.32s,
              opacity 0.25s;
  opacity: 0;
  flex-shrink: 0;
  position: relative;
}
.slots-panel.open {
  width: 240px;
  border-left-color: var(--border);
  opacity: 1;
}
.slots-inner {
  width: 240px;
  padding: 32px 20px;
  height: 100%;
  overflow-y: auto;
  display: flex; flex-direction: column;
}
.slots-date-label {
  font-size: 14px; font-weight: 700; margin-bottom: 4px;
}
.slots-count {
  font-size: 11px; color: var(--text2);
  font-family: var(--font-mono); margin-bottom: 18px;
}
.slots-list {
  display: flex; flex-direction: column; gap: 8px;
}
.slot-btn {
  background: var(--surface);
  border: 1px solid var(--border2);
  color: var(--text);
  padding: 12px 16px;
  border-radius: 10px;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 14px; font-weight: 600;
  transition: all 0.15s;
  text-align: center;
  white-space: nowrap;
  animation: slotIn 0.25s ease both;
}
.slot-btn:hover {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-fg);
  transform: translateX(3px);
}
@keyframes slotIn {
  from { opacity: 0; transform: translateX(12px); }
  to   { opacity: 1; transform: translateX(0); }
}
.slots-empty, .slots-loading {
  font-size: 12px; color: var(--text2);
  font-family: var(--font-mono); padding: 8px 0;
}
.slots-inner::-webkit-scrollbar { width: 3px; }
.slots-inner::-webkit-scrollbar-thumb { background: var(--surface2); border-radius: 2px; }

/* ── FORM PANE ── */
.form-pane {
  padding: 32px 36px;
  border-top: 1px solid var(--border);
}
.form-back {
  display: inline-flex; align-items: center; gap: 6px;
  background: none; border: none; color: var(--text2);
  font-family: var(--font-sans); font-size: 13px;
  cursor: pointer; padding: 0; margin-bottom: 24px;
  transition: color 0.15s;
}
.form-back:hover { color: var(--accent); }
.selected-slot-card {
  background: var(--surface);
  border: 1px solid var(--border2);
  border-radius: var(--r); padding: 14px 18px;
  margin-bottom: 28px;
  display: flex; gap: 14px; align-items: center;
}
.selected-slot-time { font-size: 17px; font-weight: 700; }
.selected-slot-meta { font-size: 12px; color: var(--text2); margin-top: 2px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.field { margin-bottom: 16px; }
.field-lbl {
  font-size: 11px; font-family: var(--font-mono);
  color: var(--text2); text-transform: uppercase;
  letter-spacing: 0.08em; margin-bottom: 6px;
}
.field input, .field textarea, .field select {
  background: var(--surface);
  border: 1px solid var(--border2);
  color: var(--text); padding: 11px 14px;
  border-radius: 10px; font-family: var(--font-sans);
  font-size: 14px; width: 100%;
  transition: border-color 0.15s;
}
.field input:focus, .field textarea:focus, .field select:focus {
  outline: none; border-color: var(--accent);
}
.field textarea { resize: vertical; min-height: 88px; }
.btn-confirm {
  background: var(--accent); color: var(--accent-fg);
  border: none; padding: 14px 28px;
  border-radius: var(--r); font-weight: 700;
  font-size: 15px; cursor: pointer; width: 100%;
  margin-top: 6px; font-family: var(--font-sans);
  transition: opacity 0.15s, transform 0.1s;
  letter-spacing: 0.01em;
}
.btn-confirm:hover:not(:disabled) { opacity: 0.88; }
.btn-confirm:active:not(:disabled) { transform: scale(0.99); }
.btn-confirm:disabled { opacity: 0.35; cursor: default; }
.error-msg {
  background: rgba(255,95,95,0.08); border: 1px solid var(--error);
  color: var(--error); padding: 10px 14px;
  border-radius: 8px; font-size: 13px; margin-bottom: 16px;
}

/* ── CONFIRMATION ── */
.confirm-pane {
  padding: 48px 36px;
  display: flex; flex-direction: column; align-items: flex-start;
  gap: 0;
}
.confirm-check {
  width: 54px; height: 54px; border-radius: 50%;
  background: var(--accent); color: var(--accent-fg);
  display: flex; align-items: center; justify-content: center;
  font-size: 24px; font-weight: 700; margin-bottom: 18px;
}
.confirm-headline { font-size: 26px; font-weight: 700; margin-bottom: 6px; }
.confirm-sub { font-size: 14px; color: var(--text2); margin-bottom: 24px; }
.confirm-detail {
  background: var(--surface); border: 1px solid var(--border2);
  border-radius: var(--r); overflow: hidden; width: 100%; max-width: 480px;
  margin-bottom: 16px;
}
.confirm-row {
  display: flex; gap: 12px; align-items: flex-start;
  padding: 13px 16px; border-bottom: 1px solid var(--border);
}
.confirm-row:last-child { border-bottom: none; }
.confirm-row-icon { font-size: 14px; flex-shrink: 0; margin-top: 1px; }
.confirm-row-lbl { font-size: 10px; color: var(--text2); font-family: var(--font-mono); margin-bottom: 1px; }
.confirm-row-val { font-size: 13px; font-weight: 600; }
.confirm-uid { font-size: 11px; font-family: var(--font-mono); color: var(--muted); margin-top: 4px; }
.btn-cancel-bkg {
  background: none; border: none; color: var(--muted);
  font-size: 12px; font-family: var(--font-sans);
  cursor: pointer; text-decoration: underline; margin-top: 14px;
  transition: color 0.15s;
}
.btn-cancel-bkg:hover { color: var(--error); }

/* ── CARD FOOTER ── */
.card-footer {
  padding: 10px 24px;
  border-top: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
}
.brand-link {
  font-size: 11px; font-family: var(--font-mono);
  color: var(--muted); text-decoration: none;
  display: flex; align-items: center; gap: 6px;
}
.brand-link:hover { color: var(--text2); }

/* ── RESPONSIVE ── */
@media (max-width: 720px) {
  .page { padding: 0; justify-content: flex-start; }
  .card { max-width: 100%; border-radius: 0; border-left: none; border-right: none; box-shadow: none; min-height: 100vh; }
  .card-body { flex-direction: column; }
  .info-panel {
    width: 100%; border-right: none;
    border-bottom: 1px solid var(--border);
    padding: 24px 20px 20px; flex-direction: row; flex-wrap: wrap;
    align-items: flex-start; gap: 0;
  }
  .info-avatar { display: none; }
  .info-name { width: 100%; margin-bottom: 2px; }
  .info-title { width: 100%; font-size: 18px; margin-bottom: 10px; }
  .info-meta { flex-direction: row; flex-wrap: wrap; gap: 10px 16px; }
  .info-desc { width: 100%; }
  .info-spacer { display: none; }
  .info-footer { display: none; }
  .reschedule-badge { width: 100%; }
  .picker-area { flex-direction: column; }
  .cal-panel { padding: 20px 16px; }
  .slots-panel {
    width: 100% !important;
    border-left: none !important;
    border-top: 1px solid var(--border);
    opacity: 1 !important;
    height: auto;
  }
  .slots-panel:not(.open) { display: none; }
  .slots-inner { width: 100%; padding: 16px; }
  .slots-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .slot-btn { animation: none; }
  .form-pane { padding: 20px 16px; }
  .form-grid { grid-template-columns: 1fr; }
  .confirm-pane { padding: 24px 16px; }
  .confirm-detail { max-width: 100%; }
  /* Mobile lights btn — show in footer only */
  .mobile-lights { display: flex; }
}
@media (min-width: 721px) {
  .mobile-lights { display: none; }
}

#lightsFlicker { position: fixed; inset: 0; z-index: 9999; pointer-events: none; }

/* ── EMBED BUTTON ── */
.embed-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: 20px;
  border: 1px solid var(--border2); background: transparent;
  color: var(--text2); font-family: var(--font-mono);
  font-size: 10px; letter-spacing: 0.07em;
  cursor: pointer; transition: all .18s;
}
.embed-btn:hover { border-color: var(--accent); color: var(--accent); }

/* ── EMBED MODAL ── */
.em-backdrop {
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(0,0,0,0.7);
  backdrop-filter: blur(4px);
  display: flex; align-items: flex-end; justify-content: center;
  padding: 0;
  animation: emFadeIn 0.18s ease;
}
@keyframes emFadeIn { from { opacity: 0; } to { opacity: 1; } }
.em-sheet {
  background: var(--card);
  border: 1px solid var(--border2);
  border-radius: 18px 18px 0 0;
  width: 100%; max-width: 720px;
  max-height: 85vh;
  overflow: hidden;
  display: flex; flex-direction: column;
  animation: emSlideUp 0.22s cubic-bezier(0.4,0,0.2,1);
}
@keyframes emSlideUp { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.em-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 24px 28px 0; flex-shrink: 0;
}
.em-title { font-size: 17px; font-weight: 700; margin-bottom: 4px; }
.em-sub { font-size: 13px; color: var(--text2); }
.em-close {
  background: none; border: none; color: var(--text2);
  font-size: 16px; cursor: pointer; padding: 4px 8px;
  border-radius: 6px; transition: color 0.15s, background 0.15s;
  flex-shrink: 0; margin-left: 16px;
}
.em-close:hover { color: var(--text); background: var(--surface); }

/* Tabs */
.em-tabs {
  display: flex; gap: 4px; padding: 16px 28px 0;
  border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.em-tab {
  background: none; border: none; color: var(--text2);
  font-family: var(--font-sans); font-size: 13px; font-weight: 500;
  padding: 8px 14px; cursor: pointer; border-radius: 8px 8px 0 0;
  border-bottom: 2px solid transparent; margin-bottom: -1px;
  transition: all 0.15s;
}
.em-tab:hover { color: var(--text); }
.em-tab.active { color: var(--accent); border-bottom-color: var(--accent); }

/* Panels */
.em-panels { padding: 20px 28px 28px; overflow-y: auto; flex: 1; }
.em-panel { display: none; }
.em-panel.active { display: block; }
.em-panel-desc {
  font-size: 13px; color: var(--text2);
  margin-bottom: 12px; line-height: 1.55;
}
.em-panel-desc code {
  font-family: var(--font-mono); font-size: 12px;
  background: var(--surface); padding: 1px 5px; border-radius: 4px;
  color: var(--accent);
}
.em-code-wrap { position: relative; margin-bottom: 12px; }
.em-code {
  background: var(--surface);
  border: 1px solid var(--border2);
  border-radius: 10px;
  padding: 14px 16px;
  font-family: var(--font-mono); font-size: 12px;
  color: var(--text2);
  white-space: pre-wrap; word-break: break-all;
  line-height: 1.6;
  overflow-x: auto;
  padding-right: 72px;
}
.em-copy {
  position: absolute; top: 10px; right: 10px;
  background: var(--surface2); border: 1px solid var(--border2);
  color: var(--text2); font-family: var(--font-mono); font-size: 10px;
  padding: 4px 10px; border-radius: 6px; cursor: pointer;
  transition: all 0.15s; letter-spacing: 0.05em;
}
.em-copy:hover { border-color: var(--accent); color: var(--accent); }
.em-copy.copied { border-color: var(--success, #00e5a0); color: var(--success, #00e5a0); }

.em-options {
  display: flex; flex-wrap: wrap; gap: 12px 20px;
  margin-top: 4px;
}
.em-options label {
  display: flex; flex-direction: column; gap: 5px;
  font-size: 11px; font-family: var(--font-mono);
  color: var(--text2); text-transform: uppercase; letter-spacing: 0.07em;
}
.em-select, .em-input {
  background: var(--surface); border: 1px solid var(--border2);
  color: var(--text); font-family: var(--font-sans); font-size: 13px;
  padding: 7px 10px; border-radius: 8px; cursor: pointer;
  min-width: 140px;
}
.em-select:focus, .em-input:focus { outline: none; border-color: var(--accent); }

@media (max-width: 720px) {
  .em-sheet { border-radius: 14px 14px 0 0; max-height: 90vh; }
  .em-header, .em-tabs, .em-panels { padding-left: 16px; padding-right: 16px; }
  .em-tabs { gap: 0; overflow-x: auto; }
  .em-tab { font-size: 12px; padding: 8px 10px; white-space: nowrap; }
}
</style>
</head>
<body>
<div id="lightsFlicker" style="background:rgba(255,255,230,0)"></div>
<div class="page">
  <div class="card" id="card">

    <!-- MAIN BODY -->
    <div class="card-body" id="card-body">

      <!-- INFO PANEL -->
      <div class="info-panel">
        <div class="info-avatar" id="info-avatar">📅</div>
        <div class="info-name" id="info-name">Loading...</div>
        <div class="info-title" id="info-title"></div>
        <div class="info-meta" id="info-meta"></div>
        <div class="info-desc" id="info-desc" style="display:none"></div>
        <div id="reschedule-badge" style="display:none"><div class="reschedule-badge">🔄 Rescheduling</div></div>
        <div class="info-spacer"></div>
        <div class="info-footer">
          <button class="lights-btn" id="lightsBtn">
            <span>🔦</span><span id="lightsBtnLabel">LIGHTS ON</span>
          </button>
        </div>
      </div>

      <!-- PICKER: calendar + sliding slots -->
      <div class="picker-area" id="picker-area">

        <!-- CALENDAR -->
        <div class="cal-panel">
          <div class="cal-heading">Select a date</div>
          <div class="cal-nav">
            <button class="cal-nav-btn" id="prev-month">&#8249;</button>
            <div class="cal-month" id="cal-month-label"></div>
            <button class="cal-nav-btn" id="next-month">&#8250;</button>
          </div>
          <div class="cal-grid" id="cal-grid"></div>
          <div class="tz-row">
            <span class="tz-globe">🌍</span>
            <select class="tz-select" id="tz-select"></select>
            <span class="tz-chevron">▾</span>
          </div>
        </div>

        <!-- SLOTS (slides in) -->
        <div class="slots-panel" id="slots-panel">
          <div class="slots-inner">
            <div class="slots-date-label" id="slots-date-label"></div>
            <div class="slots-count" id="slots-count"></div>
            <div class="slots-list" id="slots-list"></div>
          </div>
        </div>

      </div>
    </div>

    <!-- FORM PANE (hidden until slot selected) -->
    <div id="form-pane" class="form-pane" style="display:none">
      <button class="form-back" id="btn-back">← Back</button>
      <div class="selected-slot-card">
        <span style="font-size:22px">🕐</span>
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
      <div id="custom-fields-container"></div>
      <div class="field">
        <div class="field-lbl">Notes (optional)</div>
        <textarea id="f-notes" placeholder="Anything to share beforehand..."></textarea>
      </div>
      <button class="btn-confirm" id="btn-confirm">Confirm Booking</button>
    </div>

    <!-- CONFIRMATION PANE -->
    <div id="confirm-pane" style="display:none" class="confirm-pane">
      <div class="confirm-check" id="confirm-icon">✓</div>
      <div class="confirm-headline" id="confirm-headline">You're booked!</div>
      <div class="confirm-sub" id="confirm-sub">Confirmation sent to <strong id="confirm-email"></strong></div>
      <div class="confirm-detail" id="confirm-detail"></div>
      <div class="confirm-uid" id="confirm-uid"></div>
      <button class="btn-cancel-bkg" id="btn-cancel-bkg" style="display:none">Cancel this booking</button>
    </div>

    <!-- FOOTER -->
    <div class="card-footer" ${hideBranding ? 'style="display:none"' : ''}>
      <div style="display:flex;align-items:center;gap:16px;">
        <a class="brand-link" href="https://schedkit.net" target="_blank">
          <svg width="14" height="14" viewBox="0 0 512 512"><rect width="512" height="512" rx="80" fill="#DFFF00"/><line x1="128" y1="96" x2="208" y2="416" stroke="#0A0A0B" stroke-width="72" stroke-linecap="round"/><line x1="272" y1="96" x2="352" y2="416" stroke="#0A0A0B" stroke-width="72" stroke-linecap="round"/></svg>
          schedkit.net
        </a>
        <button class="embed-btn" id="embedBtn">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          Embed
        </button>
        <button class="lights-btn mobile-lights" id="lightsBtnMobile">
          <span>🔦</span><span id="lightsBtnLabelMobile">LIGHTS ON</span>
        </button>
      </div>
    </div>
  </div>
</div>

<!-- ── EMBED MODAL ── -->
<div id="embedModal" class="em-backdrop" style="display:none" aria-modal="true" role="dialog">
  <div class="em-sheet">
    <div class="em-header">
      <div>
        <div class="em-title">Embed this booking page</div>
        <div class="em-sub">Copy any snippet below and add it to your site, app, or platform.</div>
      </div>
      <button class="em-close" id="embedClose">✕</button>
    </div>

    <!-- TABS -->
    <div class="em-tabs">
      <button class="em-tab active" data-tab="iframe">Inline iframe</button>
      <button class="em-tab" data-tab="popup">Popup modal</button>
      <button class="em-tab" data-tab="widget">Floating widget</button>
      <button class="em-tab" data-tab="react">React</button>
    </div>

    <!-- PANELS -->
    <div class="em-panels">

      <!-- IFRAME -->
      <div class="em-panel active" data-panel="iframe">
        <div class="em-panel-desc">Drop this anywhere on a webpage to embed the booking form inline.</div>
        <div class="em-code-wrap">
          <pre class="em-code" id="code-iframe"></pre>
          <button class="em-copy" data-target="code-iframe">Copy</button>
        </div>
        <div class="em-options">
          <label>Height
            <select id="opt-height" class="em-select">
              <option value="700">700px</option>
              <option value="800" selected>800px</option>
              <option value="900">900px</option>
              <option value="100vh">Full viewport</option>
            </select>
          </label>
          <label>Width
            <select id="opt-width" class="em-select">
              <option value="100%">100%</option>
              <option value="920px">920px (max)</option>
            </select>
          </label>
        </div>
      </div>

      <!-- POPUP -->
      <div class="em-panel" data-panel="popup">
        <div class="em-panel-desc">Adds a button to your page. Clicking it opens the booking form in a centered modal overlay.</div>
        <div class="em-code-wrap">
          <pre class="em-code" id="code-popup"></pre>
          <button class="em-copy" data-target="code-popup">Copy</button>
        </div>
        <div class="em-options">
          <label>Button label
            <input type="text" id="opt-btn-label" class="em-input" value="Book a meeting" placeholder="Book a meeting">
          </label>
        </div>
      </div>

      <!-- WIDGET -->
      <div class="em-panel" data-panel="widget">
        <div class="em-panel-desc">A sticky floating button in the corner of your page. Works on any site — just paste before <code>&lt;/body&gt;</code>.</div>
        <div class="em-code-wrap">
          <pre class="em-code" id="code-widget"></pre>
          <button class="em-copy" data-target="code-widget">Copy</button>
        </div>
        <div class="em-options">
          <label>Position
            <select id="opt-corner" class="em-select">
              <option value="bottom-right" selected>Bottom right</option>
              <option value="bottom-left">Bottom left</option>
            </select>
          </label>
          <label>Label
            <input type="text" id="opt-widget-label" class="em-input" value="Book now" placeholder="Book now">
          </label>
        </div>
      </div>

      <!-- REACT -->
      <div class="em-panel" data-panel="react">
        <div class="em-panel-desc">Use the SchedKit React component. Install once, use anywhere.</div>
        <div class="em-code-wrap">
          <pre class="em-code" id="code-react-install"></pre>
          <button class="em-copy" data-target="code-react-install">Copy</button>
        </div>
        <div class="em-panel-desc" style="margin-top:16px">Then in your component:</div>
        <div class="em-code-wrap">
          <pre class="em-code" id="code-react-use"></pre>
          <button class="em-copy" data-target="code-react-use">Copy</button>
        </div>
      </div>

    </div>
  </div>
</div>

  </div>
</div>

<script>
(async () => {
  const USERNAME = ${JSON.stringify(username)};
  const EVENT_SLUG = ${JSON.stringify(eventSlug)};
  const RESCHEDULE_TOKEN = ${JSON.stringify(reschedule || null)};
  const PREFILL_NAME = ${JSON.stringify(name || '')};
  const PREFILL_EMAIL = ${JSON.stringify(email || '')};

  let eventType = null;
  let selectedDate = null;
  let selectedSlot = null;
  let currentYear, currentMonth;
  let timezone = ${JSON.stringify(tz || '')} || Intl.DateTimeFormat().resolvedOptions().timeZone;
  let availableDates = new Set();
  let cancelUrl = null;

  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();

  await loadEventType();
  populateTimezones();
  renderCalendar();
  preloadMonth();

  if (RESCHEDULE_TOKEN) {
    document.getElementById('reschedule-badge').style.display = '';
    document.getElementById('f-name').value = PREFILL_NAME;
    document.getElementById('f-email').value = PREFILL_EMAIL;
  }

  // ── Load event type ──
  async function loadEventType() {
    try {
      const res = await fetch(\`/v1/slots/\${USERNAME}/\${EVENT_SLUG}?date=\${fmtDate(now)}&timezone=\${encodeURIComponent(timezone)}\`);
      const data = await res.json();
      if (data.event_type) {
        eventType = data.event_type;
        const label = eventType.appointment_label || 'meeting';
        const locIcon = { video:'📹', phone:'📞', in_person:'📍', other:'📌' }[eventType.location_type] || '📅';
        const locLabel = eventType.location || ({ video:'Video call', phone:'Phone call', in_person:'In person' }[eventType.location_type] || 'Meeting');

        document.getElementById('info-avatar').textContent = locIcon;
        document.getElementById('info-name').textContent = USERNAME;
        document.getElementById('info-title').textContent = eventType.title;
        document.getElementById('info-meta').innerHTML = \`
          <div class="meta-row"><span class="meta-icon">⏱</span>\${eventType.duration_minutes} min</div>
          <div class="meta-row"><span class="meta-icon">\${locIcon}</span>\${locLabel}</div>
        \`;
        document.title = RESCHEDULE_TOKEN ? \`Reschedule: \${eventType.title}\` : \`Book \${label}: \${eventType.title}\`;
        document.getElementById('btn-confirm').textContent = RESCHEDULE_TOKEN
          ? 'Confirm Reschedule'
          : \`Confirm \${label.charAt(0).toUpperCase() + label.slice(1)}\`;
        if (eventType.description) {
          const d = document.getElementById('info-desc');
          d.textContent = eventType.description; d.style.display = '';
        }
        // Custom fields
        if (eventType.custom_fields) {
          let fields = [];
          try { fields = JSON.parse(eventType.custom_fields); } catch {}
          const container = document.getElementById('custom-fields-container');
          fields.forEach(f => {
            const div = document.createElement('div'); div.className = 'field';
            const req = f.required ? ' <span style="color:var(--error)">*</span>' : '';
            let inp = '';
            if (f.type === 'textarea') inp = \`<textarea id="cf-\${f.id}" placeholder="\${f.placeholder||''}"></textarea>\`;
            else if (f.type === 'select') { const o=(f.options||[]).map(x=>\`<option value="\${x}">\${x}</option>\`).join(''); inp=\`<select id="cf-\${f.id}"><option value="">Select...</option>\${o}</select>\`; }
            else { const t=f.type==='phone'?'tel':f.type==='number'?'number':'text'; inp=\`<input type="\${t}" id="cf-\${f.id}" placeholder="\${f.placeholder||''}">\`; }
            div.innerHTML = \`<div class="field-lbl">\${f.label}\${req}</div>\${inp}\`;
            container.appendChild(div);
          });
        }
      }
    } catch(e) { document.getElementById('info-name').textContent = 'Could not load event'; }
  }

  // ── Timezone ──
  function populateTimezones() {
    const sel = document.getElementById('tz-select');
    const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [
      'America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
      'America/Phoenix','Europe/London','Europe/Paris','Europe/Berlin',
      'Asia/Tokyo','Asia/Singapore','Australia/Sydney','UTC'
    ];
    zones.forEach(z => {
      const o = document.createElement('option'); o.value = z; o.textContent = z;
      if (z === timezone) o.selected = true; sel.appendChild(o);
    });
    sel.addEventListener('change', async () => {
      timezone = sel.value; availableDates.clear();
      await preloadMonth(); renderCalendar();
      if (selectedDate) loadSlots(selectedDate);
    });
  }

  // ── Calendar helpers ──
  function fmtDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  async function preloadMonth() {
    const year = currentYear, month = currentMonth;
    const daysInMonth = new Date(year, month+1, 0).getDate();
    const todayStr = fmtDate(now);
    const fetches = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = \`\${year}-\${String(month+1).padStart(2,'0')}-\${String(d).padStart(2,'0')}\`;
      if (ds < todayStr) continue;
      fetches.push(
        fetch(\`/v1/slots/\${USERNAME}/\${EVENT_SLUG}?date=\${ds}&timezone=\${encodeURIComponent(timezone)}\`)
          .then(r => r.json())
          .then(data => { if (data.slots?.length) availableDates.add(ds); })
          .catch(() => {})
      );
    }
    await Promise.all(fetches);
    renderCalendar();
  }

  function renderCalendar() {
    const MONTHS = ['January','February','March','April','May','June',
      'July','August','September','October','November','December'];
    const monthEl = document.getElementById('cal-month-label');
    monthEl.innerHTML = \`<strong>\${MONTHS[currentMonth]}</strong> <span>\${currentYear}</span>\`;

    const grid = document.getElementById('cal-grid');
    grid.innerHTML = '';
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => {
      const el = document.createElement('div'); el.className = 'cal-dow'; el.textContent = d; grid.appendChild(el);
    });

    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth+1, 0).getDate();
    const todayStr = fmtDate(now);

    for (let i = 0; i < firstDay; i++) {
      const el = document.createElement('div'); el.className = 'cal-day empty'; grid.appendChild(el);
    }
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

  document.getElementById('prev-month').addEventListener('click', async () => {
    currentMonth--; if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    availableDates.clear(); renderCalendar(); await preloadMonth();
  });
  document.getElementById('next-month').addEventListener('click', async () => {
    currentMonth++; if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    availableDates.clear(); renderCalendar(); await preloadMonth();
  });

  async function selectDate(ds) {
    selectedDate = ds; selectedSlot = null;
    renderCalendar();
    loadSlots(ds);
  }

  // ── Slots ──
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
      const res = await fetch(\`/v1/slots/\${USERNAME}/\${EVENT_SLUG}?date=\${ds}&timezone=\${encodeURIComponent(timezone)}\`);
      const data = await res.json();
      list.innerHTML = '';
      if (!data.slots?.length) {
        list.innerHTML = '<div class="slots-empty">No slots available.</div>';
        countEl.textContent = '0 available';
        return;
      }
      countEl.textContent = \`\${data.slots.length} time\${data.slots.length===1?'':'s'} available\`;
      data.slots.forEach((slot, i) => {
        const btn = document.createElement('button'); btn.className = 'slot-btn';
        const t = new Date(slot.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: timezone });
        btn.textContent = t;
        btn.style.animationDelay = \`\${i * 35}ms\`;
        btn.addEventListener('click', () => selectSlot(slot, t, ds));
        list.appendChild(btn);
      });
    } catch(e) {
      list.innerHTML = '<div class="slots-empty">Error loading slots.</div>';
    }
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
    const nameVal = document.getElementById('f-name').value.trim();
    const emailVal = document.getElementById('f-email').value.trim();
    const notes = document.getElementById('f-notes').value.trim();
    if (!nameVal || !emailVal) { showError('Name and email are required.'); return; }
    if (!/^[^@]+@[^@]+\\.[^@]+$/.test(emailVal)) { showError('Please enter a valid email.'); return; }

    const custom_responses = {};
    if (eventType?.custom_fields) {
      let fields = [];
      try { fields = JSON.parse(eventType.custom_fields); } catch {}
      for (const f of fields) {
        const el = document.getElementById(\`cf-\${f.id}\`);
        if (!el) continue;
        const val = el.value.trim();
        if (f.required && !val) { showError(\`"\${f.label}" is required.\`); return; }
        custom_responses[f.id] = val;
      }
    }

    document.getElementById('form-error').style.display = 'none';
    const btn = document.getElementById('btn-confirm');
    btn.disabled = true; btn.textContent = RESCHEDULE_TOKEN ? 'Rescheduling...' : 'Booking...';

    try {
      const url = RESCHEDULE_TOKEN ? \`/v1/reschedule/\${RESCHEDULE_TOKEN}\` : \`/v1/book/\${USERNAME}/\${EVENT_SLUG}\`;
      const body = RESCHEDULE_TOKEN
        ? { start_time: selectedSlot.start, attendee_timezone: timezone }
        : { start_time: selectedSlot.start, attendee_name: nameVal, attendee_email: emailVal,
            attendee_timezone: timezone, notes,
            custom_responses: Object.keys(custom_responses).length ? custom_responses : undefined };

      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || 'Failed. Please try again.');
        btn.disabled = false;
        const lbl = eventType?.appointment_label || 'meeting';
        btn.textContent = RESCHEDULE_TOKEN ? 'Confirm Reschedule' : \`Confirm \${lbl.charAt(0).toUpperCase()+lbl.slice(1)}\`;
        return;
      }

      const startLocal = new Date(data.start_time).toLocaleString([], {
        weekday: 'long', month: 'long', day: 'numeric',
        year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: timezone,
      });
      document.getElementById('confirm-email').textContent = emailVal;
      document.getElementById('confirm-detail').innerHTML = \`
        <div class="confirm-row"><div class="confirm-row-icon">📅</div><div><div class="confirm-row-lbl">Date & Time</div><div class="confirm-row-val">\${startLocal}</div></div></div>
        <div class="confirm-row"><div class="confirm-row-icon">🌍</div><div><div class="confirm-row-lbl">Timezone</div><div class="confirm-row-val">\${timezone}</div></div></div>
        <div class="confirm-row"><div class="confirm-row-icon">👤</div><div><div class="confirm-row-lbl">With</div><div class="confirm-row-val">\${USERNAME}</div></div></div>
      \`;
      document.getElementById('confirm-uid').textContent = 'Booking ID: ' + data.uid;

      if (data.status === 'pending') {
        document.getElementById('confirm-icon').textContent = '⏳';
        document.getElementById('confirm-headline').textContent = 'Request received!';
        document.getElementById('confirm-sub').innerHTML = 'Your request is awaiting confirmation by <strong>' + USERNAME + '</strong>. We\'ll email you at <strong id="confirm-email">' + emailVal + '</strong> once confirmed.';
      } else {
        cancelUrl = data.cancel_url;
        document.getElementById('btn-cancel-bkg').style.display = '';
      }

      document.getElementById('card-body').style.display = 'none';
      document.getElementById('form-pane').style.display = 'none';
      document.getElementById('confirm-pane').style.display = '';
    } catch(e) {
      showError('Network error. Please try again.');
      btn.disabled = false; btn.textContent = 'Confirm Booking';
    }
  });

  document.getElementById('btn-cancel-bkg').addEventListener('click', async () => {
    if (!cancelUrl || !confirm('Cancel this booking?')) return;
    try {
      await fetch(cancelUrl, { method: 'POST' });
      document.getElementById('confirm-pane').innerHTML =
        '<div style="padding:48px 36px;color:var(--text2);font-family:var(--font-mono);font-size:13px">Booking cancelled.</div>';
    } catch(e) {}
  });

  function showError(msg) {
    const el = document.getElementById('form-error'); el.textContent = msg; el.style.display = 'block';
  }

  // ── Embed modal ──
  (function() {
    const BOOK_URL = \`\${location.origin}/book/\${USERNAME}/\${EVENT_SLUG}\`;
    const modal = document.getElementById('embedModal');
    const closeBtn = document.getElementById('embedClose');

    document.getElementById('embedBtn').addEventListener('click', () => {
      modal.style.display = 'flex';
      updateCodes();
    });
    closeBtn.addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') modal.style.display = 'none'; });

    // Tabs
    document.querySelectorAll('.em-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.em-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.em-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.querySelector(\`[data-panel="\${tab.dataset.tab}"]\`).classList.add('active');
      });
    });

    // Re-generate on option change
    ['opt-height','opt-width','opt-btn-label','opt-corner','opt-widget-label'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', updateCodes);
      if (el) el.addEventListener('change', updateCodes);
    });

    function g(id, fallback) {
      const el = document.getElementById(id); return el ? el.value : fallback;
    }

    function updateCodes() {
      const h = g('opt-height', '800px');
      const w = g('opt-width', '100%');
      const btnLabel = g('opt-btn-label', 'Book a meeting');
      const corner = g('opt-corner', 'bottom-right');
      const widgetLabel = g('opt-widget-label', 'Book now');
      const isRight = corner === 'bottom-right';

      // ── Iframe ──
      document.getElementById('code-iframe').textContent =
\`<iframe
  src="\${BOOK_URL}"
  width="\${w}"
  height="\${h}"
  frameborder="0"
  style="border:none;border-radius:12px;display:block;"
  title="Booking"
  loading="lazy"
></iframe>\`;

      // ── Popup ──
      document.getElementById('code-popup').textContent =
\`<!-- SchedKit popup embed -->
<button id="sk-open-btn" style="
  background:#DFFF00;color:#0d0d0d;border:none;
  padding:12px 24px;border-radius:10px;
  font-weight:700;font-size:15px;cursor:pointer;
">\${btnLabel}</button>

<div id="sk-modal" style="display:none;position:fixed;inset:0;z-index:99999;
  background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);
  align-items:center;justify-content:center;padding:16px;">
  <div style="position:relative;width:100%;max-width:960px;
    height:90vh;border-radius:18px;overflow:hidden;
    box-shadow:0 24px 80px rgba(0,0,0,0.5);">
    <iframe id="sk-iframe" src="" style="width:100%;height:100%;border:none;"
      frameborder="0" title="Booking"></iframe>
    <button onclick="document.getElementById('sk-modal').style.display='none'"
      style="position:absolute;top:14px;right:16px;background:rgba(0,0,0,0.6);
      border:none;color:#fff;border-radius:50%;width:32px;height:32px;
      font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
  </div>
</div>
<script>
  document.getElementById('sk-open-btn').addEventListener('click', function() {
    var m = document.getElementById('sk-modal');
    document.getElementById('sk-iframe').src = '\${BOOK_URL}';
    m.style.display = 'flex';
  });
  document.getElementById('sk-modal').addEventListener('click', function(e) {
    if (e.target === this) this.style.display = 'none';
  });
<\\/script>\`;

      // ── Widget ──
      document.getElementById('code-widget').textContent =
\`<!-- SchedKit floating widget -->
<script>
(function(){
  var BOOKING_URL = '\${BOOK_URL}';
  var open = false;
  var btn = document.createElement('button');
  btn.textContent = '\${widgetLabel}';
  btn.style.cssText = 'position:fixed;\${isRight?'right':'left'}:20px;bottom:20px;z-index:99998;'+
    'background:#DFFF00;color:#0d0d0d;border:none;padding:13px 22px;'+
    'border-radius:50px;font-weight:700;font-size:14px;cursor:pointer;'+
    'box-shadow:0 4px 20px rgba(0,0,0,0.35);transition:transform .15s;';
  btn.onmouseenter = function(){ this.style.transform='scale(1.05)'; };
  btn.onmouseleave = function(){ this.style.transform='scale(1)'; };

  var overlay = document.createElement('div');
  overlay.style.cssText = 'display:none;position:fixed;inset:0;z-index:99999;'+
    'background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);'+
    'align-items:center;justify-content:center;padding:16px;';

  var frame = document.createElement('iframe');
  frame.style.cssText = 'width:100%;max-width:960px;height:90vh;border:none;'+
    'border-radius:18px;display:block;box-shadow:0 24px 80px rgba(0,0,0,0.5);';
  frame.title = 'Booking';

  var xBtn = document.createElement('button');
  xBtn.innerHTML = '✕';
  xBtn.style.cssText = 'position:fixed;\${isRight?'right':'left'}:32px;top:24px;'+
    'background:rgba(0,0,0,0.6);border:none;color:#fff;border-radius:50%;'+
    'width:36px;height:36px;font-size:16px;cursor:pointer;z-index:100000;';

  overlay.appendChild(frame);
  document.body.appendChild(overlay);
  document.body.appendChild(xBtn);
  document.body.appendChild(btn);
  xBtn.style.display = 'none';

  function openModal() {
    frame.src = BOOKING_URL;
    overlay.style.display = 'flex';
    xBtn.style.display = '';
    open = true;
  }
  function closeModal() {
    overlay.style.display = 'none';
    xBtn.style.display = 'none';
    frame.src = '';
    open = false;
  }

  btn.addEventListener('click', function(){ open ? closeModal() : openModal(); });
  xBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', function(e){ if(e.target===this) closeModal(); });
  document.addEventListener('keydown', function(e){ if(e.key==='Escape'&&open) closeModal(); });
})();
<\\/script>\`;

      // ── React ──
      document.getElementById('code-react-install').textContent =
\`npm install @schedkit/react\`;
      document.getElementById('code-react-use').textContent =
\`import { SchedKitEmbed } from '@schedkit/react';

// Inline
<SchedKitEmbed user="\${USERNAME}" event="\${EVENT_SLUG}" height={800} />

// Popup (renders a button)
<SchedKitEmbed user="\${USERNAME}" event="\${EVENT_SLUG}" mode="popup" label="Book a meeting" />

// Widget (floating button)
<SchedKitEmbed user="\${USERNAME}" event="\${EVENT_SLUG}" mode="widget" label="Book now" />\`;
    }

    // Copy buttons
    document.querySelectorAll('.em-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const pre = document.getElementById(btn.dataset.target);
        navigator.clipboard.writeText(pre.textContent).then(() => {
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800);
        }).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = pre.textContent;
          document.body.appendChild(ta); ta.select();
          document.execCommand('copy'); document.body.removeChild(ta);
          btn.textContent = 'Copied!'; btn.classList.add('copied');
          setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800);
        });
      });
    });
  })();

  // ── Lights ──
  function initLights(btnId, labelId) {
    const btn = document.getElementById(btnId);
    const label = document.getElementById(labelId);
    const flicker = document.getElementById('lightsFlicker');
    let lights = localStorage.getItem('p7-lights') === '1' ||
      (localStorage.getItem('p7-lights') === null && window.matchMedia?.('(prefers-color-scheme: light)').matches);
    function apply(on) {
      document.documentElement.setAttribute('data-lights', on ? 'on' : 'off');
      ['lightsBtnLabel','lightsBtnLabelMobile'].forEach(id => {
        const el = document.getElementById(id); if (el) el.textContent = on ? 'LIGHTS OFF' : 'LIGHTS ON';
      });
    }
    function flickerOn(cb) {
      let i = 0, fl = [80,60,100,50,120,40,200];
      function s() { flicker.style.background = i%2===0?'rgba(255,255,230,0.18)':'rgba(255,255,230,0)'; i++; if(i<fl.length)setTimeout(s,fl[i-1]);else{flicker.style.background='rgba(255,255,230,0)';cb();} }
      s();
    }
    apply(lights);
    if (btn) btn.addEventListener('click', () => {
      if (!lights) { flickerOn(() => { lights=true; localStorage.setItem('p7-lights','1'); apply(true); }); }
      else { lights=false; localStorage.setItem('p7-lights','0'); apply(false); }
    });
  }
  initLights('lightsBtn', 'lightsBtnLabel');
  initLights('lightsBtnMobile', 'lightsBtnLabelMobile');
  // Sync both buttons
  ['lightsBtn','lightsBtnMobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => {
      ['lightsBtn','lightsBtnMobile'].forEach(oid => {
        if (oid !== id) { /* already handled by apply() */ }
      });
    });
  });
})();
</script>
</body>
</html>`;
}
