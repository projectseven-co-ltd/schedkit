// Table name registry — NocoDB IDs at runtime, or Postgres table names when DATABASE_URL is set.

export const tables = {};

const POSTGRES_TABLES = {
  users: 'users',
  event_types: 'event_types',
  availability: 'availability',
  bookings: 'bookings',
  blocked_times: 'blocked_times',
  magic_links: 'magic_links',
  sessions: 'sessions',
  organizations: 'organizations',
  org_members: 'org_members',
  teams: 'teams',
  team_members: 'team_members',
  team_event_types: 'team_event_types',
  tickets: 'tickets',
  ticket_responders: 'ticket_responders',
  ticket_replies: 'ticket_replies',
  signals: 'signals',
  alerts: 'alerts',
  crosses: 'crosses',
  pushSubscriptions: 'push_subscriptions',
  calendar_connections: 'calendar_connections',
  client_flags: 'client_flags',
  leads: 'leads',
  work_orders: 'work_orders',
  work_order_incidents: 'work_order_incidents',
  work_order_time_entries: 'work_order_time_entries',
  work_order_checklist_items: 'work_order_checklist_items',
  work_order_line_items: 'work_order_line_items',
  work_order_attachments: 'work_order_attachments',
  work_order_signatures: 'work_order_signatures',
};

// NocoDB fallback IDs (used until DATABASE_URL cutover)
const NOCO_FALLBACK_IDS = {
  tickets: 'mh3shq07jve4boh',
  ticket_responders: 'mvmka9czpxr135k',
  ticket_replies: 'mrnbdc0zi78ki2l',
  pushSubscriptions: 'mbvs3axseplv86g',
  signals: 'm21ubw2908iz01s',
  alerts: 'm00769mnao3ujmr',
  crosses: 'mqbvkiidtv2xl99',
  org_members: 'mga9c2ltkvdo2iz',
  organizations: 'mdtcor4xjn6a11d',
  leads: 'm7cck1nc79fliq7',
};

export function initPostgresTables() {
  for (const [key, name] of Object.entries(POSTGRES_TABLES)) {
    tables[key] = name;
  }
}

export async function loadNocoTableIds() {
  const { meta } = await import('./nocoClient.mjs');
  const tableList = await meta.getTables();
  for (const t of tableList.list) {
    tables[t.title] = t.id;
  }
  for (const [key, id] of Object.entries(NOCO_FALLBACK_IDS)) {
    if (!tables[key]) tables[key] = id;
  }
}
