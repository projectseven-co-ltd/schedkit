// src/lib/mailer.mjs
import Mailjet from 'node-mailjet';

const mj = Mailjet.apiConnect(
  process.env.MJ_APIKEY_PUBLIC,
  process.env.MJ_APIKEY_PRIVATE
);

const FROM_EMAIL = process.env.MJ_FROM_EMAIL || 'noreply@schedkit.net';
const FROM_NAME  = process.env.MJ_FROM_NAME  || 'SchedKit';

export async function sendBookingConfirmation({ attendee_name, attendee_email, host_name, host_email, event_title, start_time, timezone, cancel_url, reschedule_url, flag }) {
  const startLocal = new Date(start_time).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: timezone,
  });

  const flagColors = { caution: '#f5a623', high: '#ff5f5f', blocked: '#ff1744' };
  const flagLabels = {
    caution: '⚠️ CAUTION',
    high: '🚨 HIGH RISK — Get payment before the appointment',
    blocked: '🚫 BLOCKED CLIENT — Consider refusing this booking',
  };
  const flagBanner = flag && flag.risk_level !== 'ok' ? `
    <tr>
      <td style="padding:0 28px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:${flagColors[flag.risk_level] || '#f5a623'}22;border:1px solid ${flagColors[flag.risk_level] || '#f5a623'};border-radius:8px;">
          <tr><td style="padding:14px 18px;">
            <p style="margin:0;font-size:13px;font-weight:700;color:${flagColors[flag.risk_level] || '#f5a623'};font-family:monospace;">${flagLabels[flag.risk_level] || flag.risk_level.toUpperCase()}</p>
            ${flag.notes ? `<p style="margin:6px 0 0;font-size:12px;color:#e8e8ea;">${flag.notes}</p>` : ''}
          </td></tr>
        </table>
      </td>
    </tr>` : '';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0a0b;font-family:'Helvetica Neue',Arial,sans-serif;color:#e8e8ea;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#111114;border:1px solid #1e1e24;border-radius:10px;overflow:hidden;">
        <tr>
          <td style="padding:12px 28px;background:#0a0a0b;border-bottom:1px solid #1e1e24;">
            <img src="https://schedkit.net/logo.png" width="32" height="32" alt="\\" style="display:block;border:0;">
          </td>
        </tr>
        <tr>
          <td style="padding:36px 28px 24px;">
            <p style="font-size:13px;color:#5a5a6e;margin:0 0 8px;">BOOKING CONFIRMED</p>
            <h1 style="margin:0 0 6px;font-size:22px;color:#e8e8ea;">${event_title}</h1>
            <p style="margin:0 0 28px;font-size:14px;color:#5a5a6e;">with ${host_name}</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;border:1px solid #1e1e24;border-radius:8px;margin-bottom:28px;">
              <tr>
                <td style="padding:16px 20px;border-bottom:1px solid #1e1e24;">
                  <p style="margin:0;font-size:11px;color:#5a5a6e;text-transform:uppercase;letter-spacing:0.05em;font-family:monospace;">Date & Time</p>
                  <p style="margin:6px 0 0;font-size:15px;font-family:monospace;color:#DFFF00;">${startLocal}</p>
                  <p style="margin:4px 0 0;font-size:12px;color:#5a5a6e;">${timezone}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0;font-size:11px;color:#5a5a6e;text-transform:uppercase;letter-spacing:0.05em;font-family:monospace;">Attendee</p>
                  <p style="margin:6px 0 0;font-size:14px;color:#e8e8ea;">${attendee_name}</p>
                  <p style="margin:2px 0 0;font-size:13px;color:#5a5a6e;">${attendee_email}</p>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 24px;font-size:13px;color:#5a5a6e;line-height:1.6;">
              Need to make a change?
              <a href="${reschedule_url || '#'}" style="color:#DFFF00;">Reschedule</a> &nbsp;·&nbsp;
              <a href="${cancel_url}" style="color:#5a5a6e;">Cancel this booking</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px;background:#0a0a0b;border-top:1px solid #1e1e24;">
            <img src="https://schedkit.net/logo.png" width="32" height="32" alt="\\" style="display:block;border:0;">
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await mj.post('send', { version: 'v3.1' }).request({
      Messages: [{
        From: { Email: FROM_EMAIL, Name: FROM_NAME },
        To: [{ Email: attendee_email, Name: attendee_name }],
        Subject: `Confirmed: ${event_title} with ${host_name}`,
        HTMLPart: html,
      }],
    });
    console.log(`Confirmation email sent to ${attendee_email}`);
  } catch(e) {
    console.error('Mailjet error:', e.message);
  }

  // Send host notification (with flag warning if applicable)
  if (host_email) {
    try {
      const hostHtml = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0b;font-family:'Helvetica Neue',Arial,sans-serif;color:#e8e8ea;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#111114;border:1px solid #1e1e24;border-radius:10px;overflow:hidden;">
        <tr><td style="padding:12px 28px;background:#0a0a0b;border-bottom:1px solid #1e1e24;">
          <img src="https://schedkit.net/logo.png" width="32" height="32" alt="\\" style="display:block;border:0;">
        </td></tr>
        ${flagBanner}
        <tr><td style="padding:28px 28px 24px;">
          <p style="font-size:13px;color:#5a5a6e;margin:0 0 8px;">NEW BOOKING</p>
          <h2 style="margin:0 0 20px;font-size:20px;color:#e8e8ea;">${event_title}</h2>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;border:1px solid #1e1e24;border-radius:8px;">
            <tr><td style="padding:14px 18px;border-bottom:1px solid #1e1e24;">
              <p style="margin:0;font-size:11px;color:#5a5a6e;font-family:monospace;text-transform:uppercase;">Attendee</p>
              <p style="margin:6px 0 0;font-size:14px;color:#e8e8ea;">${attendee_name} &lt;${attendee_email}&gt;</p>
            </td></tr>
            <tr><td style="padding:14px 18px;">
              <p style="margin:0;font-size:11px;color:#5a5a6e;font-family:monospace;text-transform:uppercase;">When</p>
              <p style="margin:6px 0 0;font-size:14px;font-family:monospace;color:#DFFF00;">${startLocal}</p>
              <p style="margin:2px 0 0;font-size:12px;color:#5a5a6e;">${timezone}</p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 28px 24px;">
          <a href="https://schedkit.net/dashboard" style="display:inline-block;background:#DFFF00;color:#0a0a0b;padding:12px 24px;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none;">View in Dashboard →</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
      await mj.post('send', { version: 'v3.1' }).request({
        Messages: [{
          From: { Email: FROM_EMAIL, Name: FROM_NAME },
          To: [{ Email: host_email, Name: host_name }],
          Subject: `${flag && flag.risk_level !== 'ok' ? `⚠️ [${flag.risk_level.toUpperCase()}] ` : ''}New booking: ${attendee_name} — ${event_title}`,
          HTMLPart: hostHtml,
        }],
      });
      console.log(`Host notification sent to ${host_email}`);
    } catch(e) {
      console.error('Host notification email error:', e.message);
    }
  }
}

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
  } catch(e) {
    console.error('Mailjet error:', e.message);
    throw e;
  }
}

export async function sendInvite({ to, inviterName, orgName, link }) {
  try {
    await mj.post('send', { version: 'v3.1' }).request({
      Messages: [{
        From: { Email: FROM_EMAIL, Name: FROM_NAME },
        To: [{ Email: to }],
        Subject: `You've been invited to join ${orgName} on SchedKit`,
        TextPart: `Hi,\n\n${inviterName} has invited you to join ${orgName} on SchedKit.\n\nClick the link below to accept and set up your account:\n\n${link}\n\nThis link expires in 24 hours.\n\nIf you weren't expecting this, you can safely ignore it.`,
        HTMLPart: `<!DOCTYPE html><html><body style="background:#0a0a0b;color:#e8e8ea;font-family:sans-serif;padding:40px;max-width:500px;margin:0 auto">
<h2 style="color:#DFFF00;font-family:monospace">SchedKit</h2>
<p>Hi,</p>
<p><strong>${inviterName}</strong> has invited you to join <strong>${orgName}</strong> on SchedKit.</p>
<p>Click below to accept the invitation and set up your account. This link expires in <strong>24 hours</strong>.</p>
<a href="${link}" style="display:inline-block;background:#DFFF00;color:#0a0a0b;padding:14px 28px;border-radius:8px;font-weight:700;text-decoration:none;margin:20px 0">Accept Invitation →</a>
<p style="color:#5a5a6e;font-size:13px">Or copy this URL: ${link}</p>
<p style="color:#5a5a6e;font-size:12px">If you weren't expecting this, you can safely ignore it.</p>
</body></html>`,
      }],
    });
  } catch(e) {
    console.error('Invite email error:', e.message);
  }
}

export async function sendMagicLink({ to, name, link }) {
  try {
    await mj.post('send', { version: 'v3.1' }).request({
      Messages: [{
        From: { Email: FROM_EMAIL, Name: FROM_NAME },
        To: [{ Email: to, Name: name }],
        Subject: 'Your SchedKit login link',
        TextPart: `Hi ${name},\n\nClick this link to log in to your SchedKit dashboard:\n\n${link}\n\nThis link expires in 15 minutes and can only be used once.\n\nIf you didn't request this, you can safely ignore it.`,
        HTMLPart: `<!DOCTYPE html><html><body style="background:#0a0a0b;color:#e8e8ea;font-family:sans-serif;padding:40px;max-width:500px;margin:0 auto">
<h2 style="color:#DFFF00;font-family:monospace">SchedKit</h2>
<p>Hi ${name},</p>
<p>Click the button below to log in to your dashboard. This link expires in <strong>15 minutes</strong>.</p>
<a href="${link}" style="display:inline-block;background:#DFFF00;color:#0a0a0b;padding:14px 28px;border-radius:8px;font-weight:700;text-decoration:none;margin:20px 0">Log in to Dashboard →</a>
<p style="color:#5a5a6e;font-size:13px">Or copy this URL: ${link}</p>
<p style="color:#5a5a6e;font-size:12px">If you didn't request this, ignore this email.</p>
</body></html>`,
      }],
    });
  } catch(e) {
    console.error('Magic link email error:', e.message);
    throw e;
  }
}

export async function sendRescheduleNotification({ attendee_name, attendee_email, host_name, event_title, old_time, new_time, timezone, cancel_url, reschedule_url, appointment_label }) {
  const label = appointment_label || 'meeting';
  const oldLocal = new Date(old_time).toLocaleString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone: timezone });
  const newLocal = new Date(new_time).toLocaleString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone: timezone });

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0b;font-family:'Helvetica Neue',Arial,sans-serif;color:#e8e8ea;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#111114;border:1px solid #1e1e24;border-radius:10px;overflow:hidden;">
        <tr><td style="padding:12px 28px;background:#0a0a0b;border-bottom:1px solid #1e1e24;">
          <img src="https://schedkit.net/logo.png" width="32" height="32" alt="\\" style="display:block;border:0;">
        </td></tr>
        <tr><td style="padding:36px 28px 24px;">
          <p style="font-size:13px;color:#5a5a6e;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em;">Your ${label} has been rescheduled</p>
          <h1 style="margin:0 0 6px;font-size:22px;color:#e8e8ea;">${event_title}</h1>
          <p style="margin:0 0 28px;font-size:14px;color:#5a5a6e;">with ${host_name}</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;border:1px solid #1e1e24;border-radius:8px;margin-bottom:28px;">
            <tr><td style="padding:16px 20px;border-bottom:1px solid #1e1e24;">
              <p style="margin:0;font-size:11px;color:#5a5a6e;text-transform:uppercase;letter-spacing:0.05em;font-family:monospace;">Previous time</p>
              <p style="margin:6px 0 0;font-size:14px;color:#5a5a6e;text-decoration:line-through;font-family:monospace;">${oldLocal}</p>
            </td></tr>
            <tr><td style="padding:16px 20px;">
              <p style="margin:0;font-size:11px;color:#5a5a6e;text-transform:uppercase;letter-spacing:0.05em;font-family:monospace;">New time</p>
              <p style="margin:6px 0 0;font-size:15px;font-family:monospace;color:#DFFF00;">${newLocal}</p>
              <p style="margin:4px 0 0;font-size:12px;color:#5a5a6e;">${timezone}</p>
            </td></tr>
          </table>
          <p style="margin:0 0 24px;font-size:13px;color:#5a5a6e;line-height:1.6;">
            Need to make another change?
            <a href="${reschedule_url || '#'}" style="color:#DFFF00;">Reschedule again</a> &nbsp;·&nbsp;
            <a href="${cancel_url}" style="color:#5a5a6e;">Cancel this booking</a>
          </p>
        </td></tr>
        <tr><td style="padding:16px 28px;background:#0a0a0b;border-top:1px solid #1e1e24;">
          <img src="https://schedkit.net/logo.png" width="32" height="32" alt="\\" style="display:block;border:0;">
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  try {
    await mj.post('send', { version: 'v3.1' }).request({
      Messages: [{
        From: { Email: FROM_EMAIL, Name: FROM_NAME },
        To: [{ Email: attendee_email, Name: attendee_name }],
        Subject: `Rescheduled: ${event_title} with ${host_name}`,
        HTMLPart: html,
      }],
    });
    console.log(`Reschedule notification sent to ${attendee_email}`);
  } catch(e) {
    console.error('Mailjet error:', e.message);
  }
}

export async function sendCancellationEmail({ attendee_name, attendee_email, host_name, event_title, start_time, timezone, appointment_label }) {
  const label = appointment_label || 'meeting';
  const startLocal = new Date(start_time).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: timezone,
  });

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0b;font-family:'Helvetica Neue',Arial,sans-serif;color:#e8e8ea;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#111114;border:1px solid #1e1e24;border-radius:10px;overflow:hidden;">
        <tr><td style="padding:12px 28px;background:#0a0a0b;border-bottom:1px solid #1e1e24;">
          <img src="https://schedkit.net/logo.png" width="32" height="32" alt="\\" style="display:block;border:0;">
        </td></tr>
        <tr><td style="padding:36px 28px 24px;">
          <p style="font-size:13px;color:#ff5f5f;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em;">Your ${label} has been cancelled</p>
          <h1 style="margin:0 0 6px;font-size:22px;color:#e8e8ea;">${event_title}</h1>
          <p style="margin:0 0 28px;font-size:14px;color:#5a5a6e;">with ${host_name}</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;border:1px solid #1e1e24;border-radius:8px;margin-bottom:28px;">
            <tr><td style="padding:16px 20px;">
              <p style="margin:0;font-size:11px;color:#5a5a6e;text-transform:uppercase;letter-spacing:0.05em;font-family:monospace;">Cancelled time</p>
              <p style="margin:6px 0 0;font-size:15px;font-family:monospace;color:#5a5a6e;text-decoration:line-through;">${startLocal}</p>
              <p style="margin:4px 0 0;font-size:12px;color:#5a5a6e;">${timezone}</p>
            </td></tr>
          </table>
          <p style="margin:0;font-size:13px;color:#5a5a6e;line-height:1.6;">If you'd like to rebook, please reach out to ${host_name} directly.</p>
        </td></tr>
        <tr><td style="padding:16px 28px;background:#0a0a0b;border-top:1px solid #1e1e24;">
          <img src="https://schedkit.net/logo.png" width="32" height="32" alt="\\" style="display:block;border:0;">
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  try {
    await mj.post('send', { version: 'v3.1' }).request({
      Messages: [{
        From: { Email: FROM_EMAIL, Name: FROM_NAME },
        To: [{ Email: attendee_email, Name: attendee_name }],
        Subject: `Cancelled: ${event_title} with ${host_name}`,
        HTMLPart: html,
      }],
    });
    console.log(`Cancellation email sent to ${attendee_email}`);
  } catch(e) {
    console.error('Mailjet cancel email error:', e.message);
  }
}
