// src/lib/schema.js — Create NocoDB tables if they don't exist

import { meta } from './noco.mjs';

const TABLES = [
  {
    name: 'users',
    columns: [
      { title: 'name', uidt: 'SingleLineText' },
      { title: 'email', uidt: 'Email' },
      { title: 'slug', uidt: 'SingleLineText' },
      { title: 'api_key', uidt: 'SingleLineText' },
      { title: 'timezone', uidt: 'SingleLineText' },
      { title: 'active', uidt: 'Checkbox' },
      { title: 'created_at', uidt: 'DateTime' },
    ],
  },
  {
    name: 'event_types',
    columns: [
      { title: 'user_id', uidt: 'SingleLineText' },
      { title: 'title', uidt: 'SingleLineText' },
      { title: 'slug', uidt: 'SingleLineText' },
      { title: 'description', uidt: 'LongText' },
      { title: 'duration_minutes', uidt: 'Number' },
      { title: 'buffer_before', uidt: 'Number' },
      { title: 'buffer_after', uidt: 'Number' },
      { title: 'max_bookings_per_day', uidt: 'Number' },
      { title: 'active', uidt: 'Checkbox' },
      { title: 'location', uidt: 'SingleLineText' },
      { title: 'location_type', uidt: 'SingleLineText' }, // inperson, phone, video, custom
      { title: 'webhook_url', uidt: 'URL' },
      { title: 'created_at', uidt: 'DateTime' },
    ],
  },
  {
    name: 'availability',
    columns: [
      { title: 'user_id', uidt: 'SingleLineText' },
      { title: 'day_of_week', uidt: 'Number' }, // 0=Sun, 6=Sat
      { title: 'start_time', uidt: 'SingleLineText' }, // "09:00"
      { title: 'end_time', uidt: 'SingleLineText' },   // "17:00"
      { title: 'timezone', uidt: 'SingleLineText' },
    ],
  },
  {
    name: 'bookings',
    columns: [
      { title: 'uid', uidt: 'SingleLineText' },
      { title: 'event_type_id', uidt: 'SingleLineText' },
      { title: 'user_id', uidt: 'SingleLineText' },
      { title: 'attendee_name', uidt: 'SingleLineText' },
      { title: 'attendee_email', uidt: 'Email' },
      { title: 'attendee_timezone', uidt: 'SingleLineText' },
      { title: 'start_time', uidt: 'DateTime' },
      { title: 'end_time', uidt: 'DateTime' },
      { title: 'status', uidt: 'SingleLineText' }, // confirmed, cancelled, rescheduled
      { title: 'notes', uidt: 'LongText' },
      { title: 'cancel_token', uidt: 'SingleLineText' },
      { title: 'reschedule_token', uidt: 'SingleLineText' },
      { title: 'created_at', uidt: 'DateTime' },
    ],
  },
  {
    name: 'blocked_times',
    columns: [
      { title: 'user_id', uidt: 'SingleLineText' },
      { title: 'start_time', uidt: 'DateTime' },
      { title: 'end_time', uidt: 'DateTime' },
      { title: 'reason', uidt: 'SingleLineText' },
    ],
  },
  {
    name: 'magic_links',
    columns: [
      { title: 'token', uidt: 'SingleLineText' },
      { title: 'user_id', uidt: 'SingleLineText' },
      { title: 'expires_at', uidt: 'DateTime' },
      { title: 'used', uidt: 'Checkbox' },
      { title: 'created_at', uidt: 'DateTime' },
    ],
  },
  {
    name: 'sessions',
    columns: [
      { title: 'token', uidt: 'SingleLineText' },
      { title: 'user_id', uidt: 'SingleLineText' },
      { title: 'expires_at', uidt: 'DateTime' },
      { title: 'created_at', uidt: 'DateTime' },
    ],
  },
];

export async function ensureSchema() {
  const existing = await meta.getTables();
  const existingNames = new Set(existing.list.map(t => t.title));

  for (const table of TABLES) {
    if (!existingNames.has(table.name)) {
      console.log(`Creating table: ${table.name}`);
      await meta.createTable(table.name, table.columns);
    } else {
      console.log(`Table exists: ${table.name}`);
    }
  }

  console.log('Schema ready.');
}
