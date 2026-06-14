-- SchedKit initial schema (Postgres migration off NocoDB)

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT,
  email TEXT,
  slug TEXT,
  api_key TEXT,
  timezone TEXT,
  active BOOLEAN DEFAULT true,
  plan TEXT DEFAULT 'free',
  ntfy_topic TEXT,
  invited BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_slug ON users (slug);
CREATE INDEX IF NOT EXISTS idx_users_api_key ON users (api_key);

CREATE TABLE IF NOT EXISTS event_types (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  slug TEXT,
  description TEXT,
  appointment_label TEXT,
  duration_minutes INTEGER,
  buffer_before INTEGER DEFAULT 0,
  buffer_after INTEGER DEFAULT 0,
  min_notice_minutes INTEGER DEFAULT 0,
  max_bookings_per_day INTEGER,
  active BOOLEAN DEFAULT true,
  location TEXT,
  location_type TEXT,
  webhook_url TEXT,
  custom_fields TEXT,
  requires_confirmation BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_types_user_id ON event_types (user_id);

CREATE TABLE IF NOT EXISTS availability (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  day_of_week INTEGER,
  start_time TEXT,
  end_time TEXT,
  timezone TEXT
);
CREATE INDEX IF NOT EXISTS idx_availability_user_id ON availability (user_id);

CREATE TABLE IF NOT EXISTS bookings (
  id BIGSERIAL PRIMARY KEY,
  uid TEXT,
  event_type_id TEXT,
  user_id TEXT NOT NULL,
  attendee_name TEXT,
  attendee_email TEXT,
  attendee_timezone TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  status TEXT,
  notes TEXT,
  custom_responses TEXT,
  cancel_token TEXT,
  reschedule_token TEXT,
  confirm_token TEXT,
  google_event_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings (user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_user_status ON bookings (user_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_start_time ON bookings (start_time);
CREATE INDEX IF NOT EXISTS idx_bookings_cancel_token ON bookings (cancel_token);
CREATE INDEX IF NOT EXISTS idx_bookings_reschedule_token ON bookings (reschedule_token);
CREATE INDEX IF NOT EXISTS idx_bookings_confirm_token ON bookings (confirm_token);

CREATE TABLE IF NOT EXISTS blocked_times (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_blocked_times_user_id ON blocked_times (user_id);

CREATE TABLE IF NOT EXISTS magic_links (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_magic_links_token ON magic_links (token);
CREATE INDEX IF NOT EXISTS idx_magic_links_user_id ON magic_links (user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token);

CREATE TABLE IF NOT EXISTS organizations (
  id BIGSERIAL PRIMARY KEY,
  name TEXT,
  slug TEXT,
  owner_user_id TEXT,
  api_key TEXT,
  ticket_subject_template TEXT,
  ticket_from_prefix TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations (slug);
CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_organizations_api_key ON organizations (api_key);

CREATE TABLE IF NOT EXISTS org_members (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_members_org_user ON org_members (org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON org_members (user_id);

CREATE TABLE IF NOT EXISTS teams (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT,
  slug TEXT,
  routing TEXT DEFAULT 'round_robin',
  last_assigned_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_teams_org_id ON teams (org_id);

CREATE TABLE IF NOT EXISTS team_members (
  id BIGSERIAL PRIMARY KEY,
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  active BOOLEAN DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members (team_id);

CREATE TABLE IF NOT EXISTS team_event_types (
  id BIGSERIAL PRIMARY KEY,
  team_id TEXT NOT NULL,
  title TEXT,
  slug TEXT,
  duration_minutes INTEGER,
  buffer_before INTEGER DEFAULT 0,
  buffer_after INTEGER DEFAULT 0,
  location TEXT,
  location_type TEXT,
  description TEXT,
  appointment_label TEXT,
  min_notice_minutes INTEGER DEFAULT 0,
  webhook_url TEXT,
  custom_fields TEXT,
  requires_confirmation BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_team_event_types_team_id ON team_event_types (team_id);

CREATE TABLE IF NOT EXISTS tickets (
  id BIGSERIAL PRIMARY KEY,
  title TEXT,
  description TEXT,
  status TEXT DEFAULT 'open',
  priority TEXT DEFAULT 'normal',
  user_id TEXT,
  source TEXT,
  source_ref TEXT,
  sla_due_at TIMESTAMPTZ,
  sla_breached BOOLEAN DEFAULT false,
  customer_token TEXT,
  customer_email TEXT,
  customer_name TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  location_name TEXT,
  org_id TEXT,
  assignee_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets (user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_customer_token ON tickets (customer_token);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status);

CREATE TABLE IF NOT EXISTS ticket_responders (
  id BIGSERIAL PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT now(),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  last_seen TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ticket_responders_ticket_id ON ticket_responders (ticket_id);

CREATE TABLE IF NOT EXISTS ticket_replies (
  id BIGSERIAL PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  user_id TEXT,
  author_name TEXT,
  author_email TEXT,
  body TEXT,
  is_staff BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_replies_ticket_id ON ticket_replies (ticket_id);

CREATE TABLE IF NOT EXISTS signals (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  org_id TEXT,
  type TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  image_url TEXT,
  note TEXT,
  ticket_id TEXT,
  meta TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signals_org_id ON signals (org_id);
CREATE INDEX IF NOT EXISTS idx_signals_user_id ON signals (user_id);
CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals (created_at DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  title TEXT,
  body TEXT,
  severity TEXT,
  source TEXT,
  source_ref TEXT,
  status TEXT DEFAULT 'firing',
  user_id TEXT,
  org_id TEXT,
  ticket_id TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  location_name TEXT,
  meta TEXT,
  fired_at TIMESTAMPTZ DEFAULT now(),
  acked_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts (user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts (status);

CREATE TABLE IF NOT EXISTS crosses (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT,
  org_id TEXT,
  name TEXT,
  meta TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT,
  subscription_json TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS calendar_connections (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  calendar_email TEXT
);
CREATE INDEX IF NOT EXISTS idx_calendar_connections_user_provider ON calendar_connections (user_id, provider);

CREATE TABLE IF NOT EXISTS client_flags (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  risk_level TEXT,
  notes TEXT,
  discount_flag TEXT,
  flagged_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_client_flags_email ON client_flags (email);

CREATE TABLE IF NOT EXISTS leads (
  id BIGSERIAL PRIMARY KEY,
  name TEXT,
  email TEXT,
  company TEXT,
  message TEXT,
  plan TEXT,
  status TEXT,
  submitted_at TIMESTAMPTZ DEFAULT now()
);
