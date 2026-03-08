// Serves the public booking page UI
// GET /book/:username/:event_slug

export default async function bookingPageRoutes(fastify) {
  fastify.get('/book/:username/:event_slug', async (req, reply) => {
    const { username, event_slug } = req.params;
    const { reschedule, name, email, tz } = req.query;
    const html = buildPage(username, event_slug, { reschedule, name, email, tz });
    reply.type('text/html').send(html);
  });
}

function buildPage(username, eventSlug, { reschedule, name, email, tz } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Book a Meeting</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0a0a0b;
    --surface: #111114;
    --border: #1e1e24;
    --accent: #DFFF00;
    --accent-dim: rgba(223,255,0,0.12);
    --text: #e8e8ea;
    --muted: #5a5a6e;
    --error: #ff5f5f;
    --success: #00e5a0;
    --font-sans: 'Space Grotesk', system-ui, sans-serif;
    --font-mono: 'Fira Code', monospace;
    --radius: 8px;
  }

  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&family=Fira+Code:wght@400;500&display=swap');

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-sans);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    padding: 40px 16px 80px;
  }

  /* Header */
  .brand { font-family: var(--font-mono); color: var(--accent); font-size: 13px; letter-spacing: 0.1em; margin-bottom: 40px; opacity: 0.7; }

  /* Card */
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    width: 100%;
    max-width: 780px;
    overflow: hidden;
  }

  /* Event header */
  .event-header {
    padding: 28px 32px 24px;
    border-bottom: 1px solid var(--border);
  }
  .event-host { font-size: 13px; color: var(--muted); margin-bottom: 6px; font-family: var(--font-mono); }
  .event-title { font-size: 22px; font-weight: 600; color: var(--text); }
  .event-meta { display: flex; gap: 20px; margin-top: 10px; }
  .event-meta span { font-size: 13px; color: var(--muted); display: flex; align-items: center; gap: 5px; }
  .event-meta .icon { font-size: 14px; }
  .event-desc { font-size: 13px; color: var(--muted); line-height: 1.6; margin-top: 12px; border-top: 1px solid var(--border); padding-top: 12px; }

  /* Layout */
  .picker { display: flex; border-bottom: 1px solid var(--border); }
  .cal-pane { flex: 0 0 320px; padding: 28px 24px; border-right: 1px solid var(--border); }
  .slots-pane { flex: 1; padding: 28px 24px; }

  @media (max-width: 600px) {
    .picker { flex-direction: column; }
    .cal-pane { border-right: none; border-bottom: 1px solid var(--border); }
    .card { border-radius: 8px; }
    .event-header { padding: 20px; }
  }

  /* Calendar */
  .cal-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .cal-nav button {
    background: none; border: 1px solid var(--border); color: var(--text);
    width: 32px; height: 32px; border-radius: 6px; cursor: pointer; font-size: 16px;
    display: flex; align-items: center; justify-content: center; transition: border-color 0.15s;
  }
  .cal-nav button:hover { border-color: var(--accent); color: var(--accent); }
  .cal-month { font-weight: 600; font-size: 15px; }
  .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
  .cal-dow { font-size: 11px; color: var(--muted); text-align: center; padding: 4px 0 8px; font-family: var(--font-mono); }
  .cal-day {
    aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
    font-size: 13px; border-radius: 6px; cursor: pointer;
    transition: background 0.1s, color 0.1s;
    border: 1px solid transparent;
  }
  .cal-day:hover:not(.disabled):not(.empty) { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
  .cal-day.selected { background: var(--accent); color: #0a0a0b; font-weight: 600; }
  .cal-day.today { border-color: var(--muted); }
  .cal-day.disabled { color: var(--muted); opacity: 0.35; cursor: default; }
  .cal-day.empty { cursor: default; }
  .cal-day.has-slots { position: relative; }
  .cal-day.has-slots::after {
    content: ''; position: absolute; bottom: 3px; left: 50%; transform: translateX(-50%);
    width: 4px; height: 4px; border-radius: 50%; background: var(--accent);
  }
  .cal-day.selected::after { background: #0a0a0b; }

  /* Timezone */
  .tz-select {
    margin-top: 20px;
    display: flex; flex-direction: column; gap: 6px;
  }
  .tz-select label { font-size: 11px; color: var(--muted); font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.05em; }
  .tz-select select {
    background: var(--bg); border: 1px solid var(--border); color: var(--text);
    padding: 8px 10px; border-radius: 6px; font-size: 13px; width: 100%; cursor: pointer;
  }
  .tz-select select:focus { outline: none; border-color: var(--accent); }

  /* Slots */
  .slots-heading { font-size: 13px; color: var(--muted); margin-bottom: 16px; font-family: var(--font-mono); }
  .slots-list { display: flex; flex-direction: column; gap: 8px; max-height: 400px; overflow-y: auto; }
  .slot-btn {
    background: none; border: 1px solid var(--border); color: var(--text);
    padding: 12px 16px; border-radius: var(--radius); cursor: pointer; text-align: left;
    font-family: var(--font-sans); font-size: 14px; font-weight: 500;
    transition: all 0.15s; display: flex; align-items: center; justify-content: space-between;
  }
  .slot-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
  .slot-btn.selected { border-color: var(--accent); background: var(--accent-dim); color: var(--accent); }
  .slot-btn .slot-confirm { font-size: 12px; opacity: 0.7; }
  .slots-empty { color: var(--muted); font-size: 14px; padding: 20px 0; }
  .slots-loading { color: var(--muted); font-size: 13px; font-family: var(--font-mono); }

  /* Form pane */
  .form-pane { padding: 28px 32px; }
  .form-pane h3 { font-size: 16px; font-weight: 600; margin-bottom: 6px; }
  .form-selected-time { font-size: 13px; color: var(--accent); font-family: var(--font-mono); margin-bottom: 24px; }
  .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
  .field label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; font-family: var(--font-mono); }
  .field input, .field textarea {
    background: var(--bg); border: 1px solid var(--border); color: var(--text);
    padding: 10px 12px; border-radius: var(--radius); font-family: var(--font-sans); font-size: 14px;
  }
  .field input:focus, .field textarea:focus { outline: none; border-color: var(--accent); }
  .field textarea { resize: vertical; min-height: 80px; }
  .btn-confirm {
    background: var(--accent); color: #0a0a0b; border: none; padding: 12px 28px;
    border-radius: var(--radius); font-weight: 600; font-size: 15px; cursor: pointer;
    width: 100%; margin-top: 8px; transition: opacity 0.15s;
  }
  .btn-confirm:hover { opacity: 0.9; }
  .btn-confirm:disabled { opacity: 0.4; cursor: default; }
  .btn-back { background: none; border: none; color: var(--muted); font-size: 13px; cursor: pointer; margin-top: 12px; text-decoration: underline; }
  .btn-back:hover { color: var(--text); }

  /* Confirmation */
  .confirm-pane { padding: 48px 32px; text-align: center; }
  .confirm-icon { font-size: 48px; margin-bottom: 16px; }
  .confirm-pane h2 { font-size: 22px; font-weight: 600; margin-bottom: 8px; }
  .confirm-pane p { color: var(--muted); font-size: 14px; margin-bottom: 6px; }
  .confirm-time { font-family: var(--font-mono); color: var(--accent); font-size: 15px; margin: 16px 0; }
  .confirm-uid { font-family: var(--font-mono); font-size: 11px; color: var(--muted); margin-top: 24px; }
  .cancel-link { color: var(--muted); font-size: 12px; text-decoration: underline; cursor: pointer; margin-top: 8px; display: inline-block; }
  .cancel-link:hover { color: var(--error); }

  /* Error */
  .error-msg { background: rgba(255,95,95,0.1); border: 1px solid var(--error); color: var(--error);
    padding: 10px 14px; border-radius: var(--radius); font-size: 13px; margin-bottom: 16px; }

  /* Scrollbar */
  .slots-list::-webkit-scrollbar { width: 4px; }
  .slots-list::-webkit-scrollbar-track { background: transparent; }
  .slots-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
</style>
</head>
<body>
<div class="brand">// schedkit</div>

<div class="card" id="app">
  <div class="event-header" id="event-header">
    <div class="event-host" id="event-host">Loading...</div>
    <div class="event-title" id="event-title"></div>
    <div class="event-meta" id="event-meta"></div>
    <div class="event-desc" id="event-desc" style="display:none"></div>
  </div>

  <!-- Step 1: Pick date + slot -->
  <div id="step-pick">
    <div class="picker">
      <div class="cal-pane">
        <div class="cal-nav">
          <button id="prev-month">&#8249;</button>
          <span class="cal-month" id="cal-month-label"></span>
          <button id="next-month">&#8250;</button>
        </div>
        <div class="cal-grid" id="cal-grid"></div>
        <div class="tz-select">
          <label>Timezone</label>
          <select id="tz-select"></select>
        </div>
      </div>
      <div class="slots-pane">
        <div class="slots-heading" id="slots-heading">Select a date</div>
        <div class="slots-list" id="slots-list"></div>
      </div>
    </div>
  </div>

  <!-- Step 2: Fill in details -->
  <div id="step-form" style="display:none">
    <div class="form-pane">
      <h3>Your details</h3>
      <div class="form-selected-time" id="form-selected-time"></div>
      <div id="form-error" style="display:none" class="error-msg"></div>
      <div class="field">
        <label>Full Name</label>
        <input type="text" id="f-name" placeholder="Jane Smith" autocomplete="name">
      </div>
      <div class="field">
        <label>Email</label>
        <input type="email" id="f-email" placeholder="jane@example.com" autocomplete="email">
      </div>
      <div class="field">
        <label>Notes (optional)</label>
        <textarea id="f-notes" placeholder="Anything you'd like to share before the call..."></textarea>
      </div>
      <button class="btn-confirm" id="btn-confirm">Confirm Booking</button>
      <br>
      <button class="btn-back" id="btn-back">← Back</button>
    </div>
  </div>

  <!-- Step 3: Confirmed -->
  <div id="step-confirmed" style="display:none">
    <div class="confirm-pane">
      <div class="confirm-icon">✅</div>
      <h2>You're booked!</h2>
      <p>A confirmation has been sent to <span id="confirm-email"></span></p>
      <div class="confirm-time" id="confirm-time"></div>
      <p id="confirm-with"></p>
      <div class="confirm-uid" id="confirm-uid"></div>
      <br>
      <a class="cancel-link" id="cancel-link">Cancel this booking</a>
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
  const API_BASE = '';

  let eventType = null;
  let selectedDate = null;
  let selectedSlot = null;
  let currentYear, currentMonth;
  let timezone = ${JSON.stringify(tz || '')} || Intl.DateTimeFormat().resolvedOptions().timeZone;
  let availableDates = new Set();

  // --- Init ---
  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();

  await loadEventType();
  populateTimezones();
  renderCalendar();
  preloadMonth();

  // Pre-fill reschedule fields
  if (RESCHEDULE_TOKEN) {
    document.getElementById('f-name').value = PREFILL_NAME;
    document.getElementById('f-email').value = PREFILL_EMAIL;
    document.querySelector('.event-meta') && (document.querySelector('.event-meta').insertAdjacentHTML('beforeend',
      '<span style="color:#DFFF00;font-size:12px;margin-left:8px">🔄 Rescheduling</span>'));
  }

  // --- Load event type ---
  async function loadEventType() {
    try {
      // Get slots for today just to resolve event type info from first slot response
      const today = fmtDate(now);
      const res = await fetch(\`\${API_BASE}/v1/slots/\${USERNAME}/\${EVENT_SLUG}?date=\${today}&timezone=\${encodeURIComponent(timezone)}\`);
      const data = await res.json();
      if (data.event_type) {
        eventType = data.event_type;
        document.getElementById('event-host').textContent = USERNAME;
        document.getElementById('event-title').textContent = eventType.title;
        const locIcon = { video:'📹', phone:'📞', in_person:'📍', other:'📌' }[eventType.location_type] || '📅';
        const locLabel = eventType.location || (eventType.location_type === 'video' ? 'Video call' : eventType.location_type === 'phone' ? 'Phone call' : eventType.location_type === 'in_person' ? 'In person' : 'Meeting');
        const label = eventType.appointment_label || 'meeting';
        document.getElementById('event-meta').innerHTML =
          \`<span><span class="icon">⏱</span>\${eventType.duration_minutes} min</span>
           <span><span class="icon">\${locIcon}</span>\${locLabel}</span>\`;
        document.title = RESCHEDULE_TOKEN ? \`Reschedule \${label}: \${eventType.title}\` : \`Book a \${label}: \${eventType.title}\`;
        document.getElementById('btn-confirm').textContent = RESCHEDULE_TOKEN ? \`Confirm Reschedule\` : \`Confirm \${label.charAt(0).toUpperCase() + label.slice(1)}\`;

        // Description
        const descEl = document.getElementById('event-desc');
        if (eventType.description) {
          descEl.textContent = eventType.description;
          descEl.style.display = '';
        }

        // Render custom fields
        if (eventType.custom_fields) {
          let fields = [];
          try { fields = JSON.parse(eventType.custom_fields); } catch {}
          if (fields.length) {
            const notesField = document.getElementById('f-notes').closest('.field');
            fields.forEach(f => {
              const div = document.createElement('div');
              div.className = 'field';
              div.dataset.customId = f.id;
              const req = f.required ? ' <span style="color:var(--error)">*</span>' : ' <span style="color:var(--muted);font-size:11px">(optional)</span>';
              let input = '';
              if (f.type === 'textarea') {
                input = \`<textarea id="cf-\${f.id}" placeholder="\${f.placeholder || ''}"></textarea>\`;
              } else if (f.type === 'select') {
                const opts = (f.options || []).map(o => \`<option value="\${o}">\${o}</option>\`).join('');
                input = \`<select id="cf-\${f.id}"><option value="">Select...</option>\${opts}</select>\`;
              } else {
                const t = f.type === 'phone' ? 'tel' : f.type === 'number' ? 'number' : 'text';
                input = \`<input type="\${t}" id="cf-\${f.id}" placeholder="\${f.placeholder || ''}">\`;
              }
              div.innerHTML = \`<label>\${f.label}\${req}</label>\${input}\`;
              notesField.insertAdjacentElement('beforebegin', div);
            });
          }
        }
      }
    } catch(e) {
      document.getElementById('event-host').textContent = 'Could not load event';
    }
  }

  // --- Timezone select ---
  function populateTimezones() {
    const sel = document.getElementById('tz-select');
    const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [
      'America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
      'America/Phoenix','Europe/London','Europe/Paris','Europe/Berlin',
      'Asia/Tokyo','Asia/Singapore','Asia/Dubai','Australia/Sydney','UTC'
    ];
    zones.forEach(z => {
      const opt = document.createElement('option');
      opt.value = z; opt.textContent = z;
      if (z === timezone) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', async () => {
      timezone = sel.value;
      availableDates.clear();
      await preloadMonth();
      renderCalendar();
      if (selectedDate) loadSlots(selectedDate);
    });
  }

  // --- Calendar ---
  function fmtDate(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth()+1).padStart(2,'0') + '-' +
      String(d.getDate()).padStart(2,'0');
  }

  async function preloadMonth() {
    // Fetch slots for each day of the month to know which have availability
    const year = currentYear, month = currentMonth;
    const daysInMonth = new Date(year, month+1, 0).getDate();
    const todayStr = fmtDate(now);
    const fetches = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = \`\${year}-\${String(month+1).padStart(2,'0')}-\${String(d).padStart(2,'0')}\`;
      if (dateStr < todayStr) continue;
      fetches.push(
        fetch(\`\${API_BASE}/v1/slots/\${USERNAME}/\${EVENT_SLUG}?date=\${dateStr}&timezone=\${encodeURIComponent(timezone)}\`)
          .then(r => r.json())
          .then(data => { if (data.slots?.length) availableDates.add(dateStr); })
          .catch(() => {})
      );
    }
    await Promise.all(fetches);
    renderCalendar();
  }

  function renderCalendar() {
    const label = document.getElementById('cal-month-label');
    const grid = document.getElementById('cal-grid');
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    label.textContent = \`\${monthNames[currentMonth]} \${currentYear}\`;

    grid.innerHTML = '';
    ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d => {
      const el = document.createElement('div');
      el.className = 'cal-dow'; el.textContent = d;
      grid.appendChild(el);
    });

    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth+1, 0).getDate();
    const todayStr = fmtDate(now);

    for (let i = 0; i < firstDay; i++) {
      const el = document.createElement('div'); el.className = 'cal-day empty'; grid.appendChild(el);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = \`\${currentYear}-\${String(currentMonth+1).padStart(2,'0')}-\${String(d).padStart(2,'0')}\`;
      const el = document.createElement('div');
      el.className = 'cal-day';
      el.textContent = d;

      if (dateStr < todayStr) { el.classList.add('disabled'); }
      else {
        if (dateStr === todayStr) el.classList.add('today');
        if (availableDates.has(dateStr)) el.classList.add('has-slots');
        if (dateStr === selectedDate) el.classList.add('selected');
        el.addEventListener('click', () => selectDate(dateStr));
      }
      grid.appendChild(el);
    }
  }

  document.getElementById('prev-month').addEventListener('click', async () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    availableDates.clear();
    renderCalendar();
    await preloadMonth();
  });

  document.getElementById('next-month').addEventListener('click', async () => {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    availableDates.clear();
    renderCalendar();
    await preloadMonth();
  });

  async function selectDate(dateStr) {
    selectedDate = dateStr;
    selectedSlot = null;
    renderCalendar();
    loadSlots(dateStr);
  }

  // --- Slots ---
  async function loadSlots(dateStr) {
    const heading = document.getElementById('slots-heading');
    const list = document.getElementById('slots-list');
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const [y,m,d] = dateStr.split('-').map(Number);
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const dow = new Date(y, m-1, d).getDay();
    heading.textContent = \`\${dayNames[dow]}, \${monthNames[m-1]} \${d}\`;
    list.innerHTML = '<div class="slots-loading">Loading slots...</div>';

    try {
      const res = await fetch(\`\${API_BASE}/v1/slots/\${USERNAME}/\${EVENT_SLUG}?date=\${dateStr}&timezone=\${encodeURIComponent(timezone)}\`);
      const data = await res.json();
      list.innerHTML = '';
      if (!data.slots?.length) {
        list.innerHTML = '<div class="slots-empty">No availability on this day.</div>';
        return;
      }
      data.slots.forEach(slot => {
        const btn = document.createElement('button');
        btn.className = 'slot-btn';
        const localTime = new Date(slot.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: timezone });
        btn.innerHTML = \`<span>\${localTime}</span><span class="slot-confirm">Select →</span>\`;
        btn.addEventListener('click', () => selectSlot(slot, localTime, dateStr));
        list.appendChild(btn);
      });
    } catch(e) {
      list.innerHTML = '<div class="slots-empty">Error loading slots.</div>';
    }
  }

  function selectSlot(slot, localTime, dateStr) {
    selectedSlot = slot;
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const [y,m,d] = dateStr.split('-').map(Number);
    document.getElementById('form-selected-time').textContent =
      \`\${localTime} · \${monthNames[m-1]} \${d}, \${y} · \${timezone}\`;
    showStep('form');
  }

  // --- Form ---
  document.getElementById('btn-back').addEventListener('click', () => showStep('pick'));

  document.getElementById('btn-confirm').addEventListener('click', async () => {
    const name = document.getElementById('f-name').value.trim();
    const email = document.getElementById('f-email').value.trim();
    const notes = document.getElementById('f-notes').value.trim();
    const errEl = document.getElementById('form-error');

    if (!name || !email) { showError('Name and email are required.'); return; }
    if (!/^[^@]+@[^@]+\\.[^@]+$/.test(email)) { showError('Please enter a valid email.'); return; }

    // Collect & validate custom fields
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

    errEl.style.display = 'none';
    const btn = document.getElementById('btn-confirm');
    btn.disabled = true;
    btn.textContent = RESCHEDULE_TOKEN ? 'Rescheduling...' : 'Booking...';

    try {
      const url = RESCHEDULE_TOKEN
        ? \`\${API_BASE}/v1/reschedule/\${RESCHEDULE_TOKEN}\`
        : \`\${API_BASE}/v1/book/\${USERNAME}/\${EVENT_SLUG}\`;

      const body = RESCHEDULE_TOKEN
        ? { start_time: selectedSlot.start, attendee_timezone: timezone }
        : { start_time: selectedSlot.start, attendee_name: name, attendee_email: email, attendee_timezone: timezone, notes, custom_responses: Object.keys(custom_responses).length ? custom_responses : undefined };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { showError(data.error || 'Failed. Please try again.'); btn.disabled = false; btn.textContent = RESCHEDULE_TOKEN ? 'Confirm Reschedule' : 'Confirm Booking'; return; }

      // Show confirmation
      const startLocal = new Date(data.start_time).toLocaleString([], {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: timezone
      });
      document.getElementById('confirm-email').textContent = email;
      document.getElementById('confirm-time').textContent = startLocal + ' · ' + timezone;
      document.getElementById('confirm-with').textContent = 'with ' + USERNAME;
      document.getElementById('confirm-uid').textContent = 'Booking ID: ' + data.uid;
      document.getElementById('cancel-link').addEventListener('click', async () => {
        if (!confirm('Cancel this booking?')) return;
        await fetch(\`\${API_BASE}\${data.cancel_url}\`, { method: 'POST' });
        document.getElementById('confirm-pane').innerHTML = '<p style="color:var(--muted);padding:40px;text-align:center">Booking cancelled.</p>';
      });
      showStep('confirmed');
    } catch(e) {
      showError('Network error. Please try again.');
      btn.disabled = false; btn.textContent = 'Confirm Booking';
    }
  });

  function showError(msg) {
    const el = document.getElementById('form-error');
    el.textContent = msg; el.style.display = 'block';
  }

  function showStep(step) {
    document.getElementById('step-pick').style.display = step === 'pick' ? '' : 'none';
    document.getElementById('step-form').style.display = step === 'form' ? '' : 'none';
    document.getElementById('step-confirmed').style.display = step === 'confirmed' ? '' : 'none';
  }
})();
</script>
</body>
</html>`;
}
