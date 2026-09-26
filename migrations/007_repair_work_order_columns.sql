-- Repair work order schemas that were created before the full work-order column set existed.

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS uid TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS site_address TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS site_notes TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal';
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS scheduled_end TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS booking_id TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS customer_email TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS customer_token TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS assignee_id TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS location_name TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS assignee_ack_at TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS dispatch_ack_at TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS en_route_at TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_work_orders_user_id ON work_orders (user_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders (status);
CREATE INDEX IF NOT EXISTS idx_work_orders_customer_token ON work_orders (customer_token);
CREATE INDEX IF NOT EXISTS idx_work_orders_uid ON work_orders (uid);
CREATE INDEX IF NOT EXISTS idx_work_orders_booking_id ON work_orders (booking_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_assignee_id ON work_orders (assignee_id);

ALTER TABLE org_members ADD COLUMN IF NOT EXISTS can_manage_work_orders BOOLEAN DEFAULT false;

ALTER TABLE work_order_attachments ADD COLUMN IF NOT EXISTS annotations TEXT;