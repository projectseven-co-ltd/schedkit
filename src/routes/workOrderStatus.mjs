// src/routes/workOrderStatus.mjs — Customer-facing work order portal

import { createHash } from 'crypto';
import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { getActiveBeaconForUser, getActiveBeaconForWorkOrder } from '../lib/activeBeacons.mjs';
import { generateWorkOrderPdf } from '../lib/workOrderPdf.mjs';

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function baseUrl() {
  return process.env.PUBLIC_BASE_URL || 'https://schedkit.net';
}

const STATUS_LABELS = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  completed: 'Completed',
  signed_off: 'Signed Off',
  closed: 'Closed',
};

async function loadWorkOrderByToken(token) {
  const result = await db.find(tables.work_orders, `(customer_token,eq,${token})`);
  return result?.list?.[0] || null;
}

async function loadPublicData(wo) {
  const id = String(wo.Id ?? wo.id);
  const [checklist, attachments, signatures] = await Promise.all([
    db.find(tables.work_order_checklist_items, `(work_order_id,eq,${id})`, { sort: 'sort_order', limit: 200 }).catch(() => ({ list: [] })),
    db.find(tables.work_order_attachments, `(work_order_id,eq,${id})`, { sort: '-created_at', limit: 50 }).catch(() => ({ list: [] })),
    db.find(tables.work_order_signatures, `(work_order_id,eq,${id})`, { limit: 10 }).catch(() => ({ list: [] })),
  ]);
  const items = checklist.list || [];
  const done = items.filter(i => i.completed).length;
  return {
    checklist: items.map(i => ({ label: i.label, completed: !!i.completed, required: !!i.required })),
    checklist_pct: items.length ? Math.round((done / items.length) * 100) : 0,
    attachments: (attachments.list || []).map(a => ({
      url: a.url,
      caption: a.caption || '',
      category: a.category || 'other',
    })),
    signatures: (signatures.list || []).map(s => ({
      role: s.role,
      signer_name: s.signer_name,
      signed_at: s.signed_at,
    })),
    customer_signed: (signatures.list || []).some(s => s.role === 'customer'),
  };
}

function buildPortalPage(wo, data, token, live = null) {
  const statusLabel = STATUS_LABELS[wo.status] || wo.status;
  const canSign = ['completed', 'signed_off'].includes(wo.status) && !data.customer_signed;
  const canPdf = ['completed', 'signed_off', 'closed'].includes(wo.status);
  const enRoute = live?.en_route;
  const enRouteCard = enRoute?.active ? `
<div class="card" id="en-route-card">
  <h2 style="font-size:16px;margin-bottom:8px;color:var(--ok)">Technician en route</h2>
  <p class="muted">Your technician is on the way.${enRoute.accuracy ? ` GPS accuracy ~${Math.round(enRoute.accuracy)}m.` : ''}</p>
  ${enRoute.lat != null && enRoute.lng != null ? `<p class="muted" style="margin-top:8px;font-family:monospace;font-size:12px">Last update: ${escHtml(new Date(enRoute.updated_at || Date.now()).toLocaleTimeString())}</p>` : ''}
</div>` : (wo.en_route_at && !['completed','signed_off','closed'].includes(wo.status) ? `
<div class="card">
  <h2 style="font-size:16px;margin-bottom:8px;color:var(--ok)">Technician en route</h2>
  <p class="muted">Dispatched at ${escHtml(new Date(wo.en_route_at).toLocaleString())}. Live GPS will appear when their beacon is active.</p>
</div>` : '');
  const photos = data.attachments.map(a => `
    <figure class="photo">
      <img src="${escHtml(a.url.startsWith('http') ? a.url : a.url)}" alt="${escHtml(a.caption || 'Photo')}" loading="lazy">
      <figcaption>${escHtml(a.category)}${a.caption ? ' · ' + escHtml(a.caption) : ''}</figcaption>
    </figure>`).join('');

  const checklistRows = data.checklist.map(i => `
    <li class="${i.completed ? 'done' : ''}">${i.completed ? '✓' : '○'} ${escHtml(i.label)}</li>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Work Order — ${escHtml(wo.title)}</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root { --bg:#0d0d10; --card:#141418; --border:#222230; --accent:#ffc700; --text:#e0e0e6; --muted:#555568; --ok:#00cc66; }
body { background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; max-width: 720px; margin: 0 auto; padding: 24px 16px 64px; }
.brand { font-family: monospace; font-size: 11px; color: var(--muted); letter-spacing: 3px; text-transform: uppercase; margin-bottom: 24px; }
.card { background: var(--card); border: 1px solid var(--border); border-top: 2px solid var(--accent); border-radius: 6px; padding: 20px; margin-bottom: 20px; }
h1 { font-size: 22px; margin-bottom: 8px; }
.badge { display: inline-block; font-size: 11px; padding: 4px 10px; border-radius: 4px; background: rgba(255,199,0,.1); color: var(--accent); margin-right: 8px; }
.muted { color: var(--muted); font-size: 14px; line-height: 1.5; }
.progress { height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; margin: 12px 0; }
.progress-bar { height: 100%; background: var(--ok); width: ${data.checklist_pct}%; }
ul.checklist { list-style: none; margin-top: 12px; }
ul.checklist li { padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
ul.checklist li.done { color: var(--ok); }
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; margin-top: 12px; }
.photo img { width: 100%; border-radius: 4px; border: 1px solid var(--border); }
.photo figcaption { font-size: 11px; color: var(--muted); margin-top: 4px; }
canvas { width: 100%; height: 160px; background: #fff; border-radius: 4px; touch-action: none; }
input[type=text] { width: 100%; padding: 10px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text); margin: 8px 0; }
.btn { display: inline-block; padding: 10px 16px; border-radius: 4px; border: none; cursor: pointer; font-weight: 600; }
.btn-primary { background: var(--accent); color: #000; }
.btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--text); text-decoration: none; }
.msg { margin-top: 12px; font-size: 13px; }
</style>
</head>
<body>
<div class="brand">SchedKit · Work Order Status</div>
<div class="card">
  <h1>${escHtml(wo.title)}</h1>
  <div style="margin-bottom:12px">
    <span class="badge">${escHtml(statusLabel)}</span>
    <span class="badge">${escHtml(wo.priority || 'normal')}</span>
  </div>
  ${wo.site_address ? `<p class="muted">${escHtml(wo.site_address)}</p>` : ''}
  ${wo.description ? `<p class="muted" style="margin-top:12px">${escHtml(wo.description)}</p>` : ''}
</div>
${enRouteCard}
<div class="card">
  <h2 style="font-size:16px;margin-bottom:8px">Checklist</h2>
  <div class="progress"><div class="progress-bar"></div></div>
  <p class="muted">${data.checklist_pct}% complete</p>
  <ul class="checklist">${checklistRows || '<li class="muted">No checklist items yet.</li>'}</ul>
</div>
${data.attachments.length ? `<div class="card"><h2 style="font-size:16px;margin-bottom:8px">Photos</h2><div class="gallery">${photos}</div></div>` : ''}
${canPdf ? `<div class="card"><a class="btn btn-ghost" href="/work-orders/status/${escHtml(token)}/report.pdf">Download evidence pack (PDF)</a></div>` : ''}
${canSign ? `<div class="card" id="sign-section">
  <h2 style="font-size:16px;margin-bottom:8px">Sign off</h2>
  <p class="muted">Sign below to confirm work completion.</p>
  <input type="text" id="signer-name" placeholder="Your full name" required>
  <canvas id="sig-canvas" width="600" height="160"></canvas>
  <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
    <button class="btn btn-ghost" type="button" onclick="clearSig()">Clear</button>
    <button class="btn btn-primary" type="button" onclick="submitSig()">Submit signature</button>
  </div>
  <p class="msg muted" id="sign-msg"></p>
</div>` : ''}
${data.customer_signed ? `<div class="card"><p class="muted" style="color:var(--ok)">✓ Customer signature on file. Thank you!</p></div>` : ''}
<script>
const token = ${JSON.stringify(token)};
const hasEnRouteFlag = ${JSON.stringify(!!wo.en_route_at)};
setInterval(async () => {
  try {
    const res = await fetch('/work-orders/status/' + token + '/live.json');
    if (!res.ok) return;
    const data = await res.json();
    const card = document.getElementById('en-route-card');
    if (data.en_route?.active && !card) location.reload();
    if (!data.en_route?.active && card && !hasEnRouteFlag) card.remove();
  } catch {}
}, 30000);
const canvas = document.getElementById('sig-canvas');
let drawing = false, ctx = canvas?.getContext('2d');
if (ctx) { ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.lineCap = 'round'; }
function pos(e) {
  const r = canvas.getBoundingClientRect();
  const t = e.touches?.[0] || e;
  return { x: (t.clientX - r.left) * (canvas.width / r.width), y: (t.clientY - r.top) * (canvas.height / r.height) };
}
function start(e) { if (!ctx) return; drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); }
function move(e) { if (!drawing || !ctx) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); }
function end() { drawing = false; }
if (canvas) {
  canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move);
  canvas.addEventListener('mouseup', end); canvas.addEventListener('mouseleave', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);
}
function clearSig() { if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); }
async function submitSig() {
  const name = document.getElementById('signer-name').value.trim();
  if (!name) { document.getElementById('sign-msg').textContent = 'Please enter your name.'; return; }
  const dataUrl = canvas.toDataURL('image/png');
  const blob = await (await fetch(dataUrl)).blob();
  const up = await fetch('/v1/upload/work-order-public/' + token, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob });
  if (!up.ok) { document.getElementById('sign-msg').textContent = 'Upload failed.'; return; }
  const { url } = await up.json();
  const res = await fetch('/work-orders/status/' + token + '/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signer_name: name, image_url: url }),
  });
  if (!res.ok) { document.getElementById('sign-msg').textContent = 'Could not save signature.'; return; }
  location.reload();
}
</script>
</body>
</html>`;
}

function buildLiveStatus(wo) {
  const woId = String(wo.Id ?? wo.id);
  let enRoute = null;
  if (wo.assignee_id) {
    const beacon = getActiveBeaconForWorkOrder(woId)
      || getActiveBeaconForUser(wo.assignee_id);
    if (beacon && beacon.lat != null && beacon.lng != null) {
      enRoute = {
        active: true,
        lat: beacon.lat,
        lng: beacon.lng,
        accuracy: beacon.accuracy ?? null,
        updated_at: new Date(beacon.lastSeen).toISOString(),
      };
    }
  }
  return {
    status: wo.status,
    en_route_at: wo.en_route_at || null,
    en_route: enRoute,
    assignee_ack_at: wo.assignee_ack_at || null,
    dispatch_ack_at: wo.dispatch_ack_at || null,
  };
}

export default async function workOrderStatusRoutes(fastify) {
  fastify.get('/work-orders/status/:token/live.json', {
    schema: {
      tags: ['Work Orders'],
      summary: 'Customer portal live status (en route beacon)',
    },
  }, async (req, reply) => {
    const wo = await loadWorkOrderByToken(req.params.token);
    if (!wo) return reply.code(404).send({ error: 'Not found' });
    return buildLiveStatus(wo);
  });

  fastify.get('/work-orders/status/:token', {
    schema: {
      tags: ['Work Orders'],
      summary: 'Customer work order status page',
      description: 'Public portal — no auth. Shows progress, checklist, photos, customer sign-off.',
    },
  }, async (req, reply) => {
    const wo = await loadWorkOrderByToken(req.params.token);
    if (!wo) return reply.code(404).type('text/html').send('<h1>Not found</h1>');
    const data = await loadPublicData(wo);
    const live = buildLiveStatus(wo);
    return reply.type('text/html').send(buildPortalPage(wo, data, req.params.token, live));
  });

  fastify.post('/work-orders/status/:token/sign', {
    schema: {
      tags: ['Work Orders'],
      summary: 'Customer signature (public)',
      body: {
        type: 'object',
        required: ['signer_name', 'image_url'],
        properties: {
          signer_name: { type: 'string' },
          image_url: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const wo = await loadWorkOrderByToken(req.params.token);
    if (!wo) return reply.code(404).send({ error: 'Not found' });
    if (!['completed', 'signed_off'].includes(wo.status)) {
      return reply.code(400).send({ error: 'Work order not ready for sign-off' });
    }

    const existing = await db.find(tables.work_order_signatures,
      `(work_order_id,eq,${wo.Id ?? wo.id})~and(role,eq,customer)`);
    if (existing.list?.length) return reply.code(409).send({ error: 'Already signed' });

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const ip_hash = createHash('sha256').update(String(ip)).digest('hex').slice(0, 16);

    await db.create(tables.work_order_signatures, {
      work_order_id: String(wo.Id ?? wo.id),
      role: 'customer',
      signer_name: req.body.signer_name,
      image_url: req.body.image_url,
      signed_at: new Date().toISOString(),
      ip_hash,
    });

    await db.update(tables.work_orders, wo.Id ?? wo.id, {
      status: 'signed_off',
      updated_at: new Date().toISOString(),
    });

    return { ok: true };
  });

  fastify.get('/work-orders/status/:token/report.pdf', {
    schema: { tags: ['Work Orders'], summary: 'Customer PDF download (public)' },
  }, async (req, reply) => {
    const wo = await loadWorkOrderByToken(req.params.token);
    if (!wo) return reply.code(404).send({ error: 'Not found' });
    if (!['completed', 'signed_off', 'closed'].includes(wo.status)) {
      return reply.code(403).send({ error: 'Report not available yet' });
    }

    const id = String(wo.Id ?? wo.id);
    const [incidents, timeEntries, checklist, lineItems, attachments, signatures] = await Promise.all([
      db.find(tables.work_order_incidents, `(work_order_id,eq,${id})`, { limit: 100 }).catch(() => ({ list: [] })),
      db.find(tables.work_order_time_entries, `(work_order_id,eq,${id})`, { limit: 200 }).catch(() => ({ list: [] })),
      db.find(tables.work_order_checklist_items, `(work_order_id,eq,${id})`, { limit: 200 }).catch(() => ({ list: [] })),
      db.find(tables.work_order_line_items, `(work_order_id,eq,${id})`, { limit: 200 }).catch(() => ({ list: [] })),
      db.find(tables.work_order_attachments, `(work_order_id,eq,${id})`, { limit: 200 }).catch(() => ({ list: [] })),
      db.find(tables.work_order_signatures, `(work_order_id,eq,${id})`, { limit: 20 }).catch(() => ({ list: [] })),
    ]);

    const enriched = {
      ...wo,
      incidents: incidents.list || [],
      time_entries: timeEntries.list || [],
      checklist: checklist.list || [],
      line_items: lineItems.list || [],
      attachments: attachments.list || [],
      signatures: signatures.list || [],
    };

    const pdf = await generateWorkOrderPdf(enriched, baseUrl());
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="work-order-${wo.uid}.pdf"`)
      .send(pdf);
  });
}
