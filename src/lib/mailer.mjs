// src/lib/mailer.mjs
import Mailjet from 'node-mailjet';

const mj = Mailjet.apiConnect(
  process.env.MJ_APIKEY_PUBLIC,
  process.env.MJ_APIKEY_PRIVATE
);

const FROM_EMAIL = process.env.MJ_FROM_EMAIL || 'noreply@schedkit.net';
const FROM_NAME  = process.env.MJ_FROM_NAME  || 'SchedKit';

export async function sendBookingConfirmation({ attendee_name, attendee_email, host_name, event_title, start_time, timezone, cancel_url, reschedule_url }) {
  const startLocal = new Date(start_time).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: timezone,
  });

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
            <span style="font-family:monospace;color:#DFFF00;font-size:12px;letter-spacing:0.1em;">// schedkit</span>
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
            <p style="margin:0;font-size:11px;color:#5a5a6e;font-family:monospace;">Powered by SchedKit</p>
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
}
