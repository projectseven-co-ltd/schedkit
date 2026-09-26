// src/routes/teamSlots.mjs — Slot availability for team event types

import { db } from '../lib/db.mjs';
import { tables } from '../lib/tables.mjs';

function addMins(date, mins) {
  return new Date(date.getTime() + mins * 60000);
}

function toDateInTZ(dateStr, tz) {
  // Returns { year, month, day, dayOfWeek } in the target timezone for dateStr
  const d = new Date(dateStr + 'T12:00:00Z'); // noon UTC to avoid date boundary issues
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(d);
  const get = (type) => parts.find(p => p.type === type)?.value;
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return {
    year: parseInt(get('year')),
    month: parseInt(get('month')) - 1,
    day: parseInt(get('day')),
    dayOfWeek: dayNames.indexOf(get('weekday')),
  };
}

function slotsForWindow(dateStr, startTime, endTime, durationMins, tz) {
  // Build slots from startTime to endTime on dateStr in given timezone
  // startTime/endTime: "HH:MM"
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);

  // Build absolute start/end in UTC by interpreting dateStr+time in tz
  // Use the trick of creating a date string and parsing with toLocaleString
  const startLocal = new Date(`${dateStr}T${startTime}:00`);
  const endLocal = new Date(`${dateStr}T${endTime}:00`);

  // Get UTC offset for that timezone at that date
  const refStr = new Date(dateStr + 'T12:00:00Z').toLocaleString('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Use Intl to build proper start/end UTC times
  function localToUTC(dateStr, timeStr, tz) {
    // Format: create a date in the timezone
    // Strategy: use the offset trick
    const iso = `${dateStr}T${timeStr}:00`;
    // Parse as UTC, then apply offset
    const dt = new Date(iso + 'Z');
    // Get what UTC time corresponds to "iso" in tz
    const tzDate = new Date(dt.toLocaleString('en-US', { timeZone: tz }));
    const utcDate = new Date(dt.toLocaleString('en-US', { timeZone: 'UTC' }));
    const offset = tzDate - utcDate; // tz offset in ms (sign: tz ahead = positive)
    // So UTC time = localTime - offset
    return new Date(dt.getTime() - offset);
  }

  const startUTC = localToUTC(dateStr, startTime, tz);
  const endUTC = localToUTC(dateStr, endTime, tz);

  const slots = [];
  let cur = startUTC;
  while (addMins(cur, durationMins) <= endUTC) {
    slots.push({ start: cur.toISOString(), end: addMins(cur, durationMins).toISOString() });
    cur = addMins(cur, durationMins);
  }
  return slots;
}

export default async function teamSlotsRoutes(fastify) {
  fastify.get('/slots/:org_slug/:team_slug/:event_slug', {
    schema: {
      tags: ['Public'],
      summary: 'Get available slots for a team event',
      description: 'Returns available time slots for a team event type on a given date. Used by the team booking page. Slots respect each team member\'s availability; at least one member must be free for a slot to appear.',
      params: { type: 'object', properties: { org_slug: { type: 'string' }, team_slug: { type: 'string' }, event_slug: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          timezone: { type: 'string', description: 'IANA timezone (e.g. America/Chicago)' },
        },
      },
    },
  }, async (req, reply) => {
    const { org_slug, team_slug, event_slug } = req.params;
    const { date, timezone = 'UTC' } = req.query;

    if (!date) return reply.code(400).send({ error: 'date required (YYYY-MM-DD)' });

    // Resolve org → team → event type
    const orgResult = await db.find(tables.organizations, `(slug,eq,${org_slug})`);
    if (!orgResult.list?.length) return reply.code(404).send({ error: 'Org not found' });
    const org = orgResult.list[0];

    const teamResult = await db.find(tables.teams, `(org_id,eq,${org.Id})~and(slug,eq,${team_slug})`);
    if (!teamResult.list?.length) return reply.code(404).send({ error: 'Team not found' });
    const team = teamResult.list[0];

    const etResult = await db.find(tables.team_event_types, `(team_id,eq,${team.Id})~and(slug,eq,${event_slug})`);
    if (!etResult.list?.length) return reply.code(404).send({ error: 'Event type not found' });
    const eventType = etResult.list[0];

    // Get day of week for the date (in user's timezone)
    const { dayOfWeek } = toDateInTZ(date, timezone);

    // Get active team members
    const tmResult = await db.find(tables.team_members, `(team_id,eq,${team.Id})~and(active,eq,true)`);
    const teamMembers = tmResult.list || [];

    if (!teamMembers.length) return { slots: [], event_type: eventType };

    // For each member: get availability for dayOfWeek, generate slots, union
    const allSlots = new Map(); // start ISO → slot

    await Promise.all(teamMembers.map(async (tm) => {
      const avResult = await db.find(
        tables.availability,
        `(user_id,eq,${tm.user_id})~and(day_of_week,eq,${dayOfWeek})`
      );
      const avRows = avResult.list || [];
      for (const av of avRows) {
        const memberSlots = slotsForWindow(date, av.start_time, av.end_time, eventType.duration_minutes, timezone);
        for (const s of memberSlots) {
          if (!allSlots.has(s.start)) allSlots.set(s.start, s);
        }
      }
    }));

    // Filter out past slots
    const now = new Date();
    const minNotice = (eventType.min_notice_minutes || 0) * 60000;
    const slots = [...allSlots.values()]
      .filter(s => new Date(s.start).getTime() >= now.getTime() + minNotice)
      .sort((a, b) => a.start.localeCompare(b.start));

    return { slots, event_type: eventType };
  });
}
