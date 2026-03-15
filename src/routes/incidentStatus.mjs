// src/routes/incidentStatus.mjs — Customer-facing status page
// Magic link via customer_token. No auth required.
// Tickets and incidents are the same object — this is the public view of a ticket/incident.

import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';
import { broadcastPublic } from './incidents.mjs';

export default async function incidentStatusRoutes(fastify) {
  // GET /incidents/status/:token — customer-facing status page
  fastify.get('/incidents/status/:token', {
    schema: {
      tags: ['Incidents'],
      summary: 'Customer status page',
      description: 'Public status page for a ticket/incident, accessed via magic link token. No auth required. Customers can view status, reply thread, and post replies.',
      params: { type: 'object', properties: { token: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { token } = req.params;
    const result = await db.find(tables.tickets, `(customer_token,eq,${token})`);
    const ticket = result?.list?.[0];
    if (!ticket) return reply.code(404).type('text/html').send('<h1>Not found</h1>');

    // Load reply thread
    let replies = [];
    try {
      const r = await db.find(tables.ticket_replies, `(ticket_id,eq,${ticket.Id})`);
      replies = (r?.list || []).sort((a, b) =>
        new Date(a.created_at || a.CreatedAt) - new Date(b.created_at || b.CreatedAt));
    } catch {}

    const html = buildStatusPage(ticket, replies, token);
    return reply.type('text/html').send(html);
  });
}

const STATUS_LABELS = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

const PRIORITY_LABELS = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildStatusPage(ticket, replies, token) {
  const repliesJson = JSON.stringify(replies);
  const ticketJson = JSON.stringify({
    Id: ticket.Id,
    title: ticket.title,
    status: ticket.status,
    priority: ticket.priority,
    sla_due_at: ticket.sla_due_at,
    sla_breached: ticket.sla_breached,
    created_at: ticket.CreatedAt || ticket.created_at,
  });
  const statusLabel = STATUS_LABELS[ticket.status] || ticket.status;
  const priorityLabel = PRIORITY_LABELS[ticket.priority] || ticket.priority;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Incident Status — ${escHtml(ticket.title)}</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0d0d10;
  --card: #141418;
  --surface: #1a1a20;
  --border: #222230;
  --acid: #DFFF00;
  --acid-dim: rgba(223,255,0,0.07);
  --text: #e0e0e6;
  --muted: #555568;
  --urgent: #ff4444;
  --high: #ff9900;
  --normal: #3399ff;
  --low: #555568;
  --ok: #00cc66;
  --warn: #ffaa00;
  --breached: #ff3333;
  --font: 'Courier New', 'Lucida Console', monospace;
  --font-body: system-ui, -apple-system, sans-serif;
  --r: 4px;
}
html { background: var(--bg); color: var(--text); font-family: var(--font-body); min-height: 100%; }
body { max-width: 680px; margin: 0 auto; padding: 32px 16px 64px; }

/* Header */
.brand {
  font-family: var(--font);
  font-size: 11px;
  color: var(--muted);
  letter-spacing: 3px;
  text-transform: uppercase;
  margin-bottom: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.brand-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--acid);
  box-shadow: 0 0 6px var(--acid);
}

/* Ticket card */
.ticket-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-top: 2px solid var(--acid);
  border-radius: var(--r);
  padding: 24px;
  margin-bottom: 24px;
}
.ticket-id {
  font-family: var(--font);
  font-size: 10px;
  color: var(--muted);
  letter-spacing: 2px;
  margin-bottom: 8px;
}
.ticket-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.3;
  margin-bottom: 16px;
}
.badge-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.badge {
  font-family: var(--font);
  font-size: 10px;
  font-weight: bold;
  padding: 3px 8px;
  border-radius: 2px;
  letter-spacing: 1px;
  text-transform: uppercase;
}
.status-badge {
  background: rgba(223,255,0,0.1);
  color: var(--acid);
  border: 1px solid rgba(223,255,0,0.3);
}
.status-badge.resolved, .status-badge.closed {
  background: rgba(0,204,102,0.1);
  color: var(--ok);
  border-color: rgba(0,204,102,0.3);
}
.priority-urgent { background: rgba(255,68,68,0.15); color: var(--urgent); border: 1px solid rgba(255,68,68,0.4); }
.priority-high { background: rgba(255,153,0,0.15); color: var(--high); border: 1px solid rgba(255,153,0,0.4); }
.priority-normal { background: rgba(51,153,255,0.1); color: var(--normal); border: 1px solid rgba(51,153,255,0.3); }
.priority-low { background: rgba(85,85,104,0.15); color: var(--muted); border: 1px solid rgba(85,85,104,0.3); }

/* Timeline */
.section-label {
  font-family: var(--font);
  font-size: 10px;
  color: var(--muted);
  letter-spacing: 3px;
  text-transform: uppercase;
  margin-bottom: 12px;
}
.timeline {
  margin-bottom: 24px;
}
.timeline-item {
  display: flex;
  gap: 12px;
  margin-bottom: 0;
  position: relative;
}
.timeline-item:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 5px; top: 14px; bottom: -2px;
  width: 1px;
  background: var(--border);
}
.tl-dot {
  width: 11px; height: 11px;
  border-radius: 50%;
  background: var(--border);
  border: 2px solid var(--muted);
  flex-shrink: 0;
  margin-top: 4px;
}
.tl-dot.active { border-color: var(--acid); background: var(--acid-dim); }
.tl-body { padding-bottom: 16px; }
.tl-label { font-size: 13px; color: var(--text); margin-bottom: 2px; }
.tl-time { font-family: var(--font); font-size: 10px; color: var(--muted); }

/* SLA */
.sla-bar {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r);
  padding: 14px 16px;
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.sla-label {
  font-family: var(--font);
  font-size: 10px;
  color: var(--muted);
  letter-spacing: 2px;
}
.sla-value {
  font-family: var(--font);
  font-size: 16px;
  font-weight: bold;
  color: var(--ok);
}
.sla-value.warning { color: var(--warn); }
.sla-value.breached { color: var(--breached); animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

/* Replies */
.replies-section {
  margin-bottom: 24px;
}
.reply-item {
  background: var(--card);
  border: 1px solid var(--border);
  border-left: 2px solid var(--border);
  border-radius: var(--r);
  padding: 12px 14px;
  margin-bottom: 8px;
}
.reply-item.staff {
  border-left-color: var(--acid);
}
.reply-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.reply-author { font-weight: 600; font-size: 13px; color: var(--text); }
.staff-tag {
  font-family: var(--font);
  font-size: 9px;
  color: var(--acid);
  background: var(--acid-dim);
  padding: 1px 5px;
  border-radius: 2px;
  letter-spacing: 1px;
}
.reply-time { font-family: var(--font); font-size: 10px; color: var(--muted); margin-left: auto; }
.reply-body { font-size: 14px; color: var(--text); line-height: 1.6; word-break: break-word; }
.no-replies { font-family: var(--font); font-size: 11px; color: var(--muted); letter-spacing: 1px; text-align: center; padding: 24px 0; }

/* Reply form */
.reply-form {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--r);
  padding: 20px;
}
.reply-form h3 {
  font-family: var(--font);
  font-size: 11px;
  color: var(--acid);
  letter-spacing: 2px;
  text-transform: uppercase;
  margin-bottom: 14px;
}
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 10px;
}
.form-input {
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 13px;
  padding: 8px 10px;
  outline: none;
  transition: border-color 0.15s;
}
.form-input:focus { border-color: var(--acid); }
textarea.form-input { resize: vertical; height: 90px; }
.form-submit {
  margin-top: 8px;
  background: var(--acid);
  color: var(--bg);
  border: none;
  border-radius: var(--r);
  padding: 10px 20px;
  font-family: var(--font);
  font-size: 11px;
  font-weight: bold;
  letter-spacing: 2px;
  cursor: pointer;
  text-transform: uppercase;
  transition: opacity 0.15s;
}
.form-submit:hover { opacity: 0.85; }
.form-submit:disabled { opacity: 0.4; cursor: default; }
.form-msg { margin-top: 8px; font-size: 12px; }
.form-msg.ok { color: var(--ok); }
.form-msg.err { color: var(--urgent); }

/* Live indicator */
#live-dot {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font);
  font-size: 10px;
  color: var(--muted);
  letter-spacing: 1px;
  margin-left: auto;
}
#live-dot.live { color: var(--ok); }
#live-dot::before {
  content: '';
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--muted);
}
#live-dot.live::before { background: var(--ok); box-shadow: 0 0 4px var(--ok); }
</style>
</head>
<body>
<div class="brand">
  <div class="brand-dot"></div>
  SCHEDKIT — INCIDENT STATUS
  <div id="live-dot">CONNECTING</div>
</div>

<div class="ticket-card">
  <div class="ticket-id">TICKET #${ticket.Id}</div>
  <div class="ticket-title">${escHtml(ticket.title)}</div>
  <div class="badge-row">
    <span class="badge status-badge ${escHtml(ticket.status)}">${escHtml(statusLabel)}</span>
    <span class="badge priority-${escHtml(ticket.priority || 'normal')}">${escHtml(priorityLabel)}</span>
  </div>
</div>

${ticket.sla_due_at ? `
<div class="sla-bar">
  <span class="sla-label">SLA REMAINING</span>
  <span class="sla-value" id="sla-val">calculating...</span>
</div>
` : ''}

<div class="timeline">
  <div class="section-label">Timeline</div>
  <div class="timeline-item">
    <div class="tl-dot active"></div>
    <div class="tl-body">
      <div class="tl-label">Ticket opened</div>
      <div class="tl-time">${escHtml(new Date(ticket.CreatedAt || ticket.created_at || Date.now()).toISOString().slice(0, 16).replace('T', ' ') + ' UTC')}</div>
    </div>
  </div>
  ${ticket.status === 'in_progress' ? `
  <div class="timeline-item">
    <div class="tl-dot active"></div>
    <div class="tl-body">
      <div class="tl-label">Work in progress</div>
      <div class="tl-time">Status: In Progress</div>
    </div>
  </div>` : ''}
  ${ticket.status === 'resolved' || ticket.status === 'closed' ? `
  <div class="timeline-item">
    <div class="tl-dot active"></div>
    <div class="tl-body">
      <div class="tl-label">${ticket.status === 'closed' ? 'Closed' : 'Resolved'}</div>
      <div class="tl-time">This ticket has been ${ticket.status}.</div>
    </div>
  </div>` : ''}
</div>

<div class="replies-section">
  <div class="section-label">Reply Thread</div>
  <div id="replies-list">${replies.length ? '' : '<div class="no-replies">NO REPLIES YET</div>'}</div>
</div>

<div class="reply-form">
  <h3>Send a Reply</h3>
  <div class="form-row">
    <input class="form-input" id="reply-name" type="text" placeholder="Your name" value="">
    <input class="form-input" id="reply-email" type="email" placeholder="Your email" value="">
  </div>
  <textarea class="form-input" id="reply-body" placeholder="Your message..."></textarea>
  <button class="form-submit" id="reply-submit">Send Reply</button>
  <div class="form-msg" id="form-msg"></div>
</div>

<script>
(function() {
  const TOKEN = ${JSON.stringify(token)};
  const TICKET_ID = ${ticket.Id};
  let ticket = ${ticketJson};
  let replies = ${repliesJson};

  // ---- SLA ----
  const SLA_HOURS = { urgent: 1, high: 4, normal: 24, low: 48 };
  function slaRemaining() {
    if (!ticket.sla_due_at) return null;
    return new Date(ticket.sla_due_at).getTime() - Date.now();
  }
  function fmtDuration(ms) {
    if (ms <= 0) return 'SLA BREACHED';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sc = s % 60;
    if (h > 0) return h + 'h ' + String(m).padStart(2,'0') + 'm remaining';
    return String(m).padStart(2,'0') + ':' + String(sc).padStart(2,'0') + ' remaining';
  }
  function slaClass() {
    const rem = slaRemaining();
    if (rem === null) return '';
    if (ticket.sla_breached || rem <= 0) return 'breached';
    const hours = SLA_HOURS[ticket.priority] || 24;
    if (rem / (hours * 3600000) <= 0.2) return 'warning';
    return '';
  }
  const slaEl = document.getElementById('sla-val');
  if (slaEl) {
    setInterval(() => {
      const rem = slaRemaining();
      if (rem !== null) {
        slaEl.textContent = fmtDuration(rem);
        slaEl.className = 'sla-value ' + slaClass();
      }
    }, 1000);
  }

  // ---- Render replies ----
  function escHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function renderReplies() {
    const list = document.getElementById('replies-list');
    if (!replies.length) {
      list.innerHTML = '<div class="no-replies">NO REPLIES YET</div>';
      return;
    }
    list.innerHTML = replies.map(r => {
      const ts = new Date(r.created_at || r.CreatedAt || Date.now()).toISOString().slice(0,16).replace('T',' ') + ' UTC';
      return '<div class="reply-item' + (r.is_staff ? ' staff' : '') + '">' +
        '<div class="reply-meta">' +
          '<span class="reply-author">' + escHtml(r.author_name || 'Unknown') + '</span>' +
          (r.is_staff ? '<span class="staff-tag">STAFF</span>' : '') +
          '<span class="reply-time">' + ts + '</span>' +
        '</div>' +
        '<div class="reply-body">' + escHtml(r.body) + '</div>' +
      '</div>';
    }).join('');
  }
  renderReplies();

  // ---- Reply submit ----
  document.getElementById('reply-submit').addEventListener('click', async () => {
    const name = document.getElementById('reply-name').value.trim();
    const email = document.getElementById('reply-email').value.trim();
    const body = document.getElementById('reply-body').value.trim();
    const msg = document.getElementById('form-msg');
    const btn = document.getElementById('reply-submit');
    if (!body) { msg.textContent = 'Reply body is required.'; msg.className = 'form-msg err'; return; }
    btn.disabled = true;
    btn.textContent = 'SENDING...';
    try {
      const res = await fetch('/v1/incidents/' + TICKET_ID + '/replies?customer_token=' + TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, author_name: name || 'Customer', author_email: email }),
      });
      if (res.ok) {
        document.getElementById('reply-body').value = '';
        msg.textContent = 'Reply sent.';
        msg.className = 'form-msg ok';
        setTimeout(() => { msg.textContent = ''; }, 3000);
      } else {
        const j = await res.json().catch(() => ({}));
        msg.textContent = j.error || 'Failed to send reply.';
        msg.className = 'form-msg err';
      }
    } catch {
      msg.textContent = 'Network error.';
      msg.className = 'form-msg err';
    }
    btn.disabled = false;
    btn.textContent = 'Send Reply';
  });

  // ---- SSE ----
  const liveDot = document.getElementById('live-dot');
  function connectSSE() {
    liveDot.textContent = 'CONNECTING';
    liveDot.className = '';
    const es = new EventSource('/v1/incidents/' + TOKEN + '/public-stream');
    es.onopen = () => { liveDot.textContent = 'LIVE'; liveDot.className = 'live'; };
    es.onerror = () => {
      liveDot.textContent = 'OFFLINE';
      liveDot.className = '';
      es.close();
      setTimeout(connectSSE, 5000);
    };
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        if (evt.type === 'reply.added' && evt.payload?.reply) {
          replies.push(evt.payload.reply);
          renderReplies();
        } else if (evt.type === 'incident.updated' || evt.type === 'incident.resolved') {
          Object.assign(ticket, evt.payload);
          // Update status badge
          const badge = document.querySelector('.status-badge');
          if (badge) {
            const labels = { open:'Open', in_progress:'In Progress', resolved:'Resolved', closed:'Closed' };
            badge.textContent = labels[ticket.status] || ticket.status;
            badge.className = 'badge status-badge ' + ticket.status;
          }
        }
      } catch {}
    };
  }
  connectSSE();
})();
</script>
</body>
</html>`;
}
