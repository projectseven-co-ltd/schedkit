// src/lib/availability.js — Slot calculation engine

import { addMinutes, format, parseISO, getDay, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { db } from './noco.mjs';
import { tables } from './tables.mjs';

/**
 * Get available slots for an event type on a given date
 * @param {string} userId
 * @param {object} eventType - { Id, duration_minutes, buffer_before, buffer_after }
 * @param {string} dateStr - "YYYY-MM-DD"
 * @param {string} timezone - attendee's timezone
 */
export async function getSlots(userId, eventType, dateStr, timezone) {
  const duration = eventType.duration_minutes || 30;
  const bufferBefore = eventType.buffer_before || 0;
  const bufferAfter = eventType.buffer_after || 0;
  const totalBlock = duration + bufferBefore + bufferAfter;

  // Get availability rules for this user/day
  const dateInTz = parseISO(`${dateStr}T00:00:00`);
  const dow = getDay(dateInTz); // 0=Sun

  const availResult = await db.find(
    tables.availability,
    `(user_id,eq,${userId})~and(day_of_week,eq,${dow})`
  );

  if (!availResult.list?.length) return [];

  const slots = [];

  for (const window of availResult.list) {
    // Build UTC start/end for this window
    const windowTz = window.timezone || 'UTC';
    const windowStart = fromZonedTime(
      parseISO(`${dateStr}T${window.start_time}:00`),
      windowTz
    );
    const windowEnd = fromZonedTime(
      parseISO(`${dateStr}T${window.end_time}:00`),
      windowTz
    );

    // Generate candidate slots
    let cursor = windowStart;
    while (addMinutes(cursor, totalBlock) <= windowEnd) {
      const slotStart = addMinutes(cursor, bufferBefore);
      const slotEnd = addMinutes(slotStart, duration);

      const free = await isSlotFree(userId, slotStart, addMinutes(cursor, totalBlock));
      if (free) {
        slots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
          // also provide in attendee's timezone
          start_local: format(toZonedTime(slotStart, timezone), "yyyy-MM-dd'T'HH:mm:ssxxx"),
          end_local: format(toZonedTime(slotEnd, timezone), "yyyy-MM-dd'T'HH:mm:ssxxx"),
        });
      }

      cursor = addMinutes(cursor, totalBlock);
    }
  }

  return slots;
}

async function isSlotFree(userId, start, end) {
  // Check existing bookings
  const bookings = await db.list(tables.bookings, {
    where: `(user_id,eq,${userId})~and(status,eq,confirmed)~and(start_time,lt,${end.toISOString()})~and(end_time,gt,${start.toISOString()})`,
    limit: 1,
  });
  if (bookings.list?.length) return false;

  // Check blocked times
  const blocked = await db.list(tables.blocked_times, {
    where: `(user_id,eq,${userId})~and(start_time,lt,${end.toISOString()})~and(end_time,gt,${start.toISOString()})`,
    limit: 1,
  });
  if (blocked.list?.length) return false;

  return true;
}
