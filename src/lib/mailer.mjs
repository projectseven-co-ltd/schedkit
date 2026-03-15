// src/lib/mailer.mjs
import Mailjet from 'node-mailjet';

const mj = Mailjet.apiConnect(
  process.env.MJ_APIKEY_PUBLIC,
  process.env.MJ_APIKEY_PRIVATE
);

const FROM_EMAIL = process.env.MJ_FROM_EMAIL || 'noreply@schedkit.net';
const FROM_NAME  = process.env.MJ_FROM_NAME  || 'SchedKit';

// ── Shared chrome ─────────────────────────────────────────────────────────────

function emailWrap(body) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0a0b;font-family:'Helvetica Neue',Arial,sans-serif;color:#e8e8ea;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#111114;border:1px solid #1e1e24;border-radius:10px;overflow:hidden;">

        <!-- header -->
        <tr>
          <td style="padding:16px 28px;background:#0a0a0b;border-bottom:1px solid #1e1e24;">
            <img src="https://schedkit.net/logo.png" width="32" height="32" alt="SchedKit" style="display:block;border:0;">
          </td>
        </tr>

        <!-- body -->
        <tr><td style="padding:36px 28px 28px;">${body}</td></tr>

        <!-- footer -->
        <tr>
          <td style="padding:16px 28px;background:#0a0a0b;border-top:1px solid #1e1e24;text-align:center;">
            <a href="https://schedkit.net" style="display:inline-flex;align-items:center;gap:6px;color:#3a3a4a;font-size:12px;text-decoration:none;font-family:'Helvetica Neue',Arial,sans-serif;">
              <img src="https://schedkit.net/logo.png" width="16" height="16" alt="" style="display:inline-block;border:0;vertical-align:middle;">
              schedkit.net
            </a>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

function label(text) {
  return `<p style="margin:0;font-size:11px;color:#5a5a6e;text-transform:uppercase;letter-spacing:0.06em;font-family:monospace;">${text}</p>`;
}

function detailTable(rows) {
  const cells = rows.map(([k, v], i) => {
    const border = i < rows.length - 1 ? 'border-bottom:1px solid #1e1e24;' : '';
    return `<tr>
      <td style="padding:14px 20px;${border}font-size:13px;color:#5a5a6e;white-space:nowrap;">${k}</td>
      <td style="padding:14px 20px;${border}font-size:13px;color:#e8e8ea;text-align:right;">${v}</td>
    </tr>`;
  }).join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;border:1px solid #1e1e24;border-radius:8px;margin-bottom:28px;">${cells}</table>`;
}

function statusLine(text, color) {
  return `<p style="margin:0 0 12px;font-size:11px;color:${color};text-transform:uppercase;letter-spacing:0.08em;font-family:monospace;">${text}</p>`;
}

function heading(text) {
  return `<h1 style="margin:0 0 6px;font-size:22px;color:#e8e8ea;font-weight:700;">${text}</h1>`;
}

function subheading(text) {
  return `<p style="margin:0 0 28px;font-size:14px;color:#5a5a6e;line-height:1.5;">${text}</p>`;
}

function note(text) {
  return `<p style="margin:0;font-size:13px;color:#5a5a6e;line-height:1.6;">${text}</p>`;
}

function primaryBtn(url, text) {
  return `<a href="${url}" style="display:inline-block;background:#DFFF00;color:#0a0a0b;padding:13px 28px;border-radius:8px;font-weight:700;font-size:14px;text-decoration:none;">${text}</a>`;
}

function ghostBtn(url, text) {
  return `<a href="${url}" style="display:inline-block;background:#1a1a1f;color:#e8e8ea;padding:12px 22px;border-radius:8px;font-size:13px;text-decoration:none;border:1px solid #2e2e3a;">${text}</a>`;
}

async function send(to_email, to_name, subject, html, text) {
  await mj.post('send', { version: 'v3.1' }).request({
    Messages: [{
      From: { Email: FROM_EMAIL, Name: FROM_NAME },
      To: [{ Email: to_email, Name: to_name || to_email }],
      Subject: subject,
      HTMLPart: html,
      ...(text ? { TextPart: text } : {}),
    }],
  });
}

function fmtTime(iso, tz) {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: tz,
  });
}

// ── Booking confirmed (attendee) ──────────────────────────────────────────────
export async function sendBookingConfirmation({ attendee_name, attendee_email, host_name, host_email, event_title, start_time, timezone, cancel_url, reschedule_url, flag }) {
  const startLocal = fmtTime(start_time, timezone);

  const flagColors = { caution: '#f5a623', high: '#ff5f5f', blocked: '#ff1744' };
  const flagLabels = {
    caution: '[!] CAUTION',
    high: '[!] HIGH RISK — Get payment before the appointment',
    blocked: '[⊘] BLOCKED CLIENT — Consider refusing this booking',
  };
  const flagBanner = flag && flag.risk_level !== 'ok' ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${flagColors[flag.risk_level]}22;border:1px solid ${flagColors[flag.risk_level]};border-radius:8px;margin-bottom:20px;">
      <tr><td style="padding:14px 18px;">
        <p style="margin:0;font-size:13px;font-weight:700;color:${flagColors[flag.risk_level]};font-family:monospace;">${flagLabels[flag.risk_level] || flag.risk_level.toUpperCase()}</p>
        ${flag.notes ? `<p style="margin:6px 0 0;font-size:12px;color:#e8e8ea;">${flag.notes}</p>` : ''}
      </td></tr>
    </table>` : '';

  // Attendee email
  const attendeeHtml = emailWrap(`
    ${statusLine('✓ BOOKING CONFIRMED', '#4ade80')}
    ${heading(event_title)}
    ${subheading(`with ${host_name}`)}
    ${detailTable([
      ['Date & time', `<span style="font-family:monospace;color:#DFFF00;">${startLocal}</span>`],
      ['Timezone', timezone],
      ['Attendee', attendee_name],
    ])}
    <table cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding-right:10px;">${ghostBtn(reschedule_url || '#', 'Reschedule')}</td>
        <td>${ghostBtn(cancel_url, 'Cancel booking')}</td>
      </tr>
    </table>
  `);

  // Host email
  const hostHtml = emailWrap(`
    ${flagBanner}
    ${statusLine('NEW BOOKING', '#DFFF00')}
    ${heading(event_title)}
    ${subheading(`Booked by ${attendee_name}`)}
    ${detailTable([
      ['Attendee', `${attendee_name} &lt;${attendee_email}&gt;`],
      ['Date & time', `<span style="font-family:monospace;color:#DFFF00;">${startLocal}</span>`],
      ['Timezone', timezone],
    ])}
    ${primaryBtn('https://schedkit.net/dashboard', 'View in Dashboard →')}
  `);

  try {
    await send(attendee_email, attendee_name, `Confirmed: ${event_title} with ${host_name}`, attendeeHtml);
    console.log(`Confirmation email sent to ${attendee_email}`);
  } catch(e) { console.error('Confirmation email error:', e.message); }

  if (host_email) {
    try {
      await mj.post('send', { version: 'v3.1' }).request({
        Messages: [{
          From: { Email: FROM_EMAIL, Name: FROM_NAME },
          To: [{ Email: host_email, Name: host_name }],
          Subject: `${flag && flag.risk_level !== 'ok' ? `[!] [${flag.risk_level.toUpperCase()}] ` : ''}New booking: ${attendee_name} — ${event_title}`,
          HTMLPart: hostHtml,
        }],
      });
      console.log(`Host notification sent to ${host_email}`);
    } catch(e) { console.error('Host notification email error:', e.message); }
  }
}

// ── Access request (internal) ─────────────────────────────────────────────────
export async function sendAccessRequest({ name, email, company, message }) {
  try {
    await mj.post('send', { version: 'v3.1' }).request({
      Messages: [{
        From: { Email: FROM_EMAIL, Name: FROM_NAME },
        To: [{ Email: 'jrj@p7n.net', Name: 'Jason' }],
        ReplyTo: { Email: email, Name: name },
        Subject: `SchedKit Access Request: ${name}${company ? ' — ' + company : ''}`,
        TextPart: `Name: ${name}\nEmail: ${email}\nCompany: ${company || 'n/a'}\n\n${message || '(no message)'}`,
      }],
    });
    console.log(`Access request from ${email}`);
  } catch(e) { console.error('Access request email error:', e.message); throw e; }
}


export async function sendWelcome({ name, email }) {
  try {
    await mj.post('send', { version: 'v3.1' }).request({
      Messages: [{
        From: { Email: FROM_EMAIL, Name: FROM_NAME },
        To: [{ Email: email, Name: name }],
        Subject: 'Welcome to SchedKit',
        HTMLPart: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#0a0a0b;font-family:'Helvetica Neue',Arial,sans-serif;color:#e8e8ea;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:40px 0;"><tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="background:#111114;border:1px solid #1e1e24;border-radius:10px;overflow:hidden;"><tr><td style="padding:16px 28px;background:#0a0a0b;border-bottom:1px solid #1e1e24;"><span style="color:#DFFF00;font-family:monospace;font-size:18px;font-weight:bold;">SCHEDKIT</span></td></tr><tr><td style="padding:32px 28px;"><p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#e8e8ea;">Welcome, ${name}.</p><p style="margin:0 0 24px;font-size:14px;color:#aaa;line-height:1.6;">Your account is ready. Head to your dashboard to set up your first event type and start taking bookings.</p><a href="https://schedkit.net/dashboard" style="display:inline-block;background:#DFFF00;color:#0a0a0b;text-decoration:none;padding:12px 24px;border-radius:6px;font-family:monospace;font-size:13px;font-weight:700;letter-spacing:0.05em;">OPEN DASHBOARD →</a></td></tr><tr><td style="padding:16px 28px;border-top:1px solid #1e1e24;font-size:12px;color:#5a5a6e;">SchedKit · <a href="https://schedkit.net/docs" style="color:#5a5a6e;">docs</a> · reply to this email anytime</td></tr></table></td></tr></table></body></html>`,
      }],
    });
  } catch(e) { console.error('Welcome email error:', e.message); throw e; }
}
// ── Org invite ────────────────────────────────────────────────────────────────
export async function sendInvite({ to, inviterName, orgName, link }) {
  const html = emailWrap(`
    ${statusLine('YOU HAVE BEEN INVITED', '#DFFF00')}
    ${heading(`Join ${orgName} on SchedKit`)}
    ${subheading(`${inviterName} has invited you to join their organization.`)}
    ${detailTable([
      ['Organization', orgName],
      ['Invited by', inviterName],
      ['Link expires', '24 hours'],
    ])}
    ${primaryBtn(link, 'Accept Invitation →')}
    <br><br>
    ${note(`Or copy this URL: <a href="${link}" style="color:#5a5a6e;word-break:break-all;">${link}</a>`)}
    <br><br>
    ${note("If you weren't expecting this, you can safely ignore it.")}
  `);
  try {
    await send(to, '', `You've been invited to join ${orgName} on SchedKit`, html);
  } catch(e) { console.error('Invite email error:', e.message); }
}

// ── Magic link (login) ────────────────────────────────────────────────────────
export async function sendMagicLink({ to, name, link, code }) {
  const html = emailWrap(`
    ${statusLine('LOGIN LINK', '#DFFF00')}
    ${heading('Your login link')}
    ${subheading('Use the code below in the SchedKit app, or tap the button to log in in your browser. This link expires in <strong style="color:#e8e8ea;">15 minutes</strong> and can only be used once.')}
    <div style="background:#0a0a0b;border:1px solid #2a3410;border-radius:12px;padding:20px 20px 18px;margin:0 0 22px;text-align:center;">
      <p style="margin:0 0 8px;font-size:11px;color:#5a5a6e;text-transform:uppercase;letter-spacing:0.08em;font-family:monospace;">Login code</p>
      <div style="font-family:monospace;font-size:32px;font-weight:700;letter-spacing:0.24em;color:#DFFF00;line-height:1;">${code}</div>
      <p style="margin:12px 0 0;font-size:12px;color:#5a5a6e;line-height:1.5;">Using the iPhone app? Enter this code directly in SchedKit.</p>
    </div>
    ${primaryBtn(link, 'Log in to Dashboard →')}
    <br><br>
    ${note(`Or copy this URL: <a href="${link}" style="color:#5a5a6e;word-break:break-all;">${link}</a>`)}
    <br><br>
    ${note("If you didn't request this, you can safely ignore it.")}
  `);
  const text = `Your SchedKit login code: ${code}\n\nUse this code in the SchedKit app, or open this link in your browser:\n${link}\n\nThis code and link expire in 15 minutes. If you didn't request this, you can safely ignore it.`;
  try {
    await send(to, name, `Your SchedKit login code: ${code}`, html, text);
  } catch(e) { console.error('Magic link email error:', e.message); throw e; }
}

// ── Reschedule notification (attendee) ────────────────────────────────────────
export async function sendRescheduleNotification({ attendee_name, attendee_email, host_name, event_title, old_time, new_time, timezone, cancel_url, reschedule_url, appointment_label }) {
  const label = appointment_label || 'meeting';
  const oldLocal = fmtTime(old_time, timezone);
  const newLocal  = fmtTime(new_time, timezone);

  const html = emailWrap(`
    ${statusLine(`YOUR ${label.toUpperCase()} HAS BEEN RESCHEDULED`, '#DFFF00')}
    ${heading(event_title)}
    ${subheading(`with ${host_name}`)}
    ${detailTable([
      ['Previous time', `<span style="font-family:monospace;color:#5a5a6e;text-decoration:line-through;">${oldLocal}</span>`],
      ['New time', `<span style="font-family:monospace;color:#DFFF00;">${newLocal}</span>`],
      ['Timezone', timezone],
    ])}
    <table cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding-right:10px;">${ghostBtn(reschedule_url || '#', 'Reschedule again')}</td>
        <td>${ghostBtn(cancel_url, 'Cancel booking')}</td>
      </tr>
    </table>
  `);

  try {
    await send(attendee_email, attendee_name, `Rescheduled: ${event_title} with ${host_name}`, html);
    console.log(`Reschedule notification sent to ${attendee_email}`);
  } catch(e) { console.error('Reschedule email error:', e.message); }
}

// ── Cancellation (attendee) ───────────────────────────────────────────────────
export async function sendCancellationEmail({ attendee_name, attendee_email, host_name, event_title, start_time, timezone, appointment_label }) {
  const label = appointment_label || 'meeting';
  const startLocal = fmtTime(start_time, timezone);

  const html = emailWrap(`
    ${statusLine(`YOUR ${label.toUpperCase()} HAS BEEN CANCELLED`, '#ff5f5f')}
    ${heading(event_title)}
    ${subheading(`with ${host_name}`)}
    ${detailTable([
      ['Cancelled time', `<span style="font-family:monospace;color:#5a5a6e;text-decoration:line-through;">${startLocal}</span>`],
      ['Timezone', timezone],
    ])}
    ${note(`If you'd like to rebook, please reach out to ${host_name} directly.`)}
  `);

  try {
    await send(attendee_email, attendee_name, `Cancelled: ${event_title} with ${host_name}`, html);
    console.log(`Cancellation email sent to ${attendee_email}`);
  } catch(e) { console.error('Cancellation email error:', e.message); }
}

// ── Pending booking (attendee) ────────────────────────────────────────────────
export async function sendBookingPending({ attendee_name, attendee_email, host_name, event_title, start_time, timezone }) {
  const startLocal = fmtTime(start_time, timezone);

  const html = emailWrap(`
    ${statusLine('⏳ AWAITING CONFIRMATION', '#DFFF00')}
    ${heading('Your booking request was received')}
    ${subheading(`${host_name} will review and confirm your booking shortly.`)}
    ${detailTable([
      ['Event', event_title],
      ['With', host_name],
      ['Requested time', `<span style="font-family:monospace;">${startLocal}</span>`],
      ['Timezone', timezone],
    ])}
    ${note("You'll receive a confirmation email once your booking is accepted. No action needed right now.")}
  `);

  try {
    await send(attendee_email, attendee_name, `Booking request received: ${event_title} with ${host_name}`, html);
  } catch(e) { console.error('Pending email error:', e.message); }
}

// ── Host confirmation request ─────────────────────────────────────────────────
export async function sendHostConfirmationRequest({ host_name, host_email, attendee_name, attendee_email, event_title, start_time, timezone, notes, confirm_url, decline_url }) {
  const startLocal = fmtTime(start_time, timezone);
  const noteRow = notes ? [['Notes', notes]] : [];

  const html = emailWrap(`
    ${statusLine('NEW BOOKING REQUEST', '#DFFF00')}
    ${heading('New booking request')}
    ${subheading(`${attendee_name} wants to book time with you.`)}
    ${detailTable([
      ['Name', attendee_name],
      ['Email', `<a href="mailto:${attendee_email}" style="color:#e8e8ea;text-decoration:none;">${attendee_email}</a>`],
      ['Event', event_title],
      ['Requested time', `<span style="font-family:monospace;color:#DFFF00;">${startLocal}</span>`],
      ['Timezone', timezone],
      ...noteRow,
    ])}
    <table cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr>
        <td style="padding-right:12px;">${primaryBtn(confirm_url, '✓ Confirm booking')}</td>
        <td>${ghostBtn(decline_url, '✕ Decline')}</td>
      </tr>
    </table>
    ${note('These links are single-use. No login required.')}
  `);

  try {
    await mj.post('send', { version: 'v3.1' }).request({
      Messages: [{
        From: { Email: FROM_EMAIL, Name: FROM_NAME },
        To: [{ Email: host_email, Name: host_name }],
        Subject: `New booking request: ${attendee_name} — ${event_title}`,
        HTMLPart: html,
      }],
    });
  } catch(e) { console.error('Host confirmation request email error:', e.message); }
}

// ── Booking confirmed by host (attendee) ─────────────────────────────────────
export async function sendBookingConfirmedByHost({ attendee_name, attendee_email, host_name, event_title, start_time, timezone, cancel_url, reschedule_url }) {
  const startLocal = fmtTime(start_time, timezone);

  const html = emailWrap(`
    ${statusLine('✓ CONFIRMED', '#4ade80')}
    ${heading('Your booking is confirmed')}
    ${subheading(`${host_name} has accepted your booking request.`)}
    ${detailTable([
      ['Event', event_title],
      ['With', host_name],
      ['When', `<span style="font-family:monospace;color:#DFFF00;">${startLocal}</span>`],
      ['Timezone', timezone],
    ])}
    <table cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding-right:10px;">${ghostBtn(reschedule_url || '#', 'Reschedule')}</td>
        <td>${ghostBtn(cancel_url, 'Cancel booking')}</td>
      </tr>
    </table>
  `);

  try {
    await send(attendee_email, attendee_name, `Confirmed: ${event_title} with ${host_name}`, html);
  } catch(e) { console.error('Confirmed-by-host email error:', e.message); }
}

// ── Booking declined by host (attendee) ──────────────────────────────────────
export async function sendBookingDeclined({ attendee_name, attendee_email, host_name, event_title, start_time, timezone }) {
  const startLocal = fmtTime(start_time, timezone);

  const html = emailWrap(`
    ${statusLine('✕ DECLINED', '#ff5f5f')}
    ${heading('Booking request declined')}
    ${subheading(`${host_name} was unable to accept your booking request.`)}
    ${detailTable([
      ['Event', event_title],
      ['With', host_name],
      ['Requested time', `<span style="font-family:monospace;color:#5a5a6e;text-decoration:line-through;">${startLocal}</span>`],
      ['Timezone', timezone],
    ])}
    ${note("If you'd like to try a different time, visit the booking page to make a new request.")}
  `);

  try {
    await send(attendee_email, attendee_name, `Booking declined: ${event_title} with ${host_name}`, html);
  } catch(e) { console.error('Declined email error:', e.message); }
}
