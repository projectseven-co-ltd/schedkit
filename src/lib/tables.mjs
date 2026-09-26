// Table name registry for the Postgres adapter.

export const tables = {};

const TABLES = {
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
  clients: 'clients',
  client_domains: 'client_domains',
  client_contacts: 'client_contacts',
  ticket_departments: 'ticket_departments',
  leads: 'leads',
  work_orders: 'work_orders',
  work_order_incidents: 'work_order_incidents',
  work_order_time_entries: 'work_order_time_entries',
  work_order_checklist_items: 'work_order_checklist_items',
  work_order_line_items: 'work_order_line_items',
  work_order_attachments: 'work_order_attachments',
  work_order_signatures: 'work_order_signatures',
};

export function initPostgresTables() {
  for (const [key, name] of Object.entries(TABLES)) {
    tables[key] = name;
  }
}
