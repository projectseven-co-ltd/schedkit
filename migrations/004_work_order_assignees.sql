-- Work order assignment + org dispatch permissions

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS assignee_id TEXT;
CREATE INDEX IF NOT EXISTS idx_work_orders_assignee_id ON work_orders (assignee_id);

ALTER TABLE org_members ADD COLUMN IF NOT EXISTS can_manage_work_orders BOOLEAN DEFAULT false;
