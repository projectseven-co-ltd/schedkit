-- Work Orders module — field job documentation

CREATE TABLE IF NOT EXISTS work_orders (
  id BIGSERIAL PRIMARY KEY,
  uid TEXT NOT NULL,
  user_id TEXT NOT NULL,
  org_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  site_address TEXT,
  site_notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  priority TEXT DEFAULT 'normal',
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  booking_id TEXT,
  customer_name TEXT,
  customer_email TEXT,
  customer_token TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  location_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_orders_user_id ON work_orders (user_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders (status);
CREATE INDEX IF NOT EXISTS idx_work_orders_customer_token ON work_orders (customer_token);
CREATE INDEX IF NOT EXISTS idx_work_orders_uid ON work_orders (uid);
CREATE INDEX IF NOT EXISTS idx_work_orders_booking_id ON work_orders (booking_id);

CREATE TABLE IF NOT EXISTS work_order_incidents (
  id BIGSERIAL PRIMARY KEY,
  work_order_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_order_incidents_pair ON work_order_incidents (work_order_id, ticket_id);
CREATE INDEX IF NOT EXISTS idx_work_order_incidents_wo ON work_order_incidents (work_order_id);

CREATE TABLE IF NOT EXISTS work_order_time_entries (
  id BIGSERIAL PRIMARY KEY,
  work_order_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'on_site',
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_minutes INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_order_time_wo ON work_order_time_entries (work_order_id);
CREATE INDEX IF NOT EXISTS idx_work_order_time_user ON work_order_time_entries (work_order_id, user_id);

CREATE TABLE IF NOT EXISTS work_order_checklist_items (
  id BIGSERIAL PRIMARY KEY,
  work_order_id TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  required BOOLEAN DEFAULT false,
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_order_checklist_wo ON work_order_checklist_items (work_order_id);

CREATE TABLE IF NOT EXISTS work_order_line_items (
  id BIGSERIAL PRIMARY KEY,
  work_order_id TEXT NOT NULL,
  description TEXT NOT NULL,
  sku TEXT,
  quantity NUMERIC DEFAULT 1,
  unit TEXT,
  unit_cost NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_order_line_items_wo ON work_order_line_items (work_order_id);

CREATE TABLE IF NOT EXISTS work_order_attachments (
  id BIGSERIAL PRIMARY KEY,
  work_order_id TEXT NOT NULL,
  url TEXT NOT NULL,
  filename TEXT,
  mime_type TEXT,
  caption TEXT,
  category TEXT DEFAULT 'other',
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_order_attachments_wo ON work_order_attachments (work_order_id);

CREATE TABLE IF NOT EXISTS work_order_signatures (
  id BIGSERIAL PRIMARY KEY,
  work_order_id TEXT NOT NULL,
  role TEXT NOT NULL,
  signer_name TEXT NOT NULL,
  image_url TEXT NOT NULL,
  signed_at TIMESTAMPTZ DEFAULT now(),
  ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_work_order_signatures_wo ON work_order_signatures (work_order_id);
