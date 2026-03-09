// src/lib/googleCalendar.mjs — Google Calendar integration

import { db } from './noco.mjs';
import { tables } from './tables.mjs';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'schedkit.net';
const REDIRECT_URI = `https://${BASE_DOMAIN}/google-callback`;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly email profile',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  return res.json();
}

export async function refreshAccessToken(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  return res.json();
}

// Get a valid access token for a user, refreshing if needed
export async function getValidToken(userId) {
  const result = await db.find(tables.calendar_connections, `(user_id,eq,${userId})~and(provider,eq,google)`);
  const conn = result.list?.[0];
  if (!conn) return null;

  const expiresAt = new Date(conn.expires_at);
  // Refresh if expired or expiring within 5 minutes
  if (expiresAt < new Date(Date.now() + 5 * 60 * 1000)) {
    try {
      const tokens = await refreshAccessToken(conn.refresh_token);
      const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
      await db.update(tables.calendar_connections, conn.Id, {
        access_token: tokens.access_token,
        expires_at: newExpiry,
      });
      return tokens.access_token;
    } catch (e) {
      console.error('Token refresh error:', e.message);
      return null;
    }
  }
  return conn.access_token;
}

// Check if a time slot is busy on Google Calendar
export async function isSlotBusy(userId, startIso, endIso) {
  const token = await getValidToken(userId);
  if (!token) return false; // no calendar connected — don't block

  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: startIso,
      timeMax: endIso,
      items: [{ id: 'primary' }],
    }),
  });
  if (!res.ok) { console.error('FreeBusy error:', await res.text()); return false; }
  const data = await res.json();
  const busy = data.calendars?.primary?.busy || [];
  return busy.length > 0;
}

// Create a Google Calendar event after booking
export async function createCalendarEvent(userId, { title, description, startIso, endIso, attendeeEmail, attendeeName, location }) {
  const token = await getValidToken(userId);
  if (!token) return null;

  const body = {
    summary: title,
    description,
    start: { dateTime: startIso },
    end: { dateTime: endIso },
    attendees: [{ email: attendeeEmail, displayName: attendeeName }],
  };
  if (location) body.location = location;

  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) { console.error('Create event error:', await res.text()); return null; }
  return res.json();
}

// Delete a Google Calendar event by eventId
export async function deleteCalendarEvent(userId, eventId) {
  const token = await getValidToken(userId);
  if (!token) return;

  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    console.error('Delete event error:', res.status, await res.text());
  }
}
