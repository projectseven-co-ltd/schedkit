-- Work Orders v1.2: photo markup, dispatch ack, en-route tracking

ALTER TABLE work_order_attachments ADD COLUMN IF NOT EXISTS annotations TEXT;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS assignee_ack_at TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS dispatch_ack_at TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS en_route_at TIMESTAMPTZ;
