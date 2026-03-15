// src/lib/notify.mjs — push notifications (ntfy, future: slack, discord, webhook)

export async function notifyNewBooking(user, booking, eventType) {
  const ntfyTopic = user.ntfy_topic;
  if (!ntfyTopic) return;

  const title = `New ${eventType.appointment_label || 'booking'}`;
  const startLocal = new Date(booking.start_time).toLocaleString('en-US', {
    timeZone: user.timezone || 'UTC',
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  const message = `${booking.attendee_name} (${booking.attendee_email})\n${startLocal}`;

  await sendNtfy(ntfyTopic, title, message, '[◷]', 'high');
}

export async function notifyBookingCancelled(user, booking, eventType) {
  const ntfyTopic = user.ntfy_topic;
  if (!ntfyTopic) return;

  const title = `${eventType.appointment_label || 'Booking'} cancelled`;
  const startLocal = new Date(booking.start_time).toLocaleString('en-US', {
    timeZone: user.timezone || 'UTC',
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  const message = `${booking.attendee_name}\n${startLocal}`;

  await sendNtfy(ntfyTopic, title, message, '[×]', 'default');
}

async function sendNtfy(topic, title, message, emoji = '[◷]', priority = 'default') {
  // Support both full URLs (https://ntfy.sh/mytopic) and bare topics (mytopic → ntfy.sh)
  const url = topic.startsWith('http') ? topic : `https://ntfy.sh/${topic}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Title': title,
        'Tags': `schedkit`,
        'Priority': priority,
        'Tags': 'schedkit',
      },
      body: message,
    });
    if (!res.ok) console.error('ntfy error:', res.status, await res.text());
  } catch(e) {
    console.error('ntfy send failed:', e.message);
  }
}
