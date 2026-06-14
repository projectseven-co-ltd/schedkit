const ALLOWED_COLUMNS = new Set([
  'id', 'Id', 'name', 'email', 'slug', 'api_key', 'timezone', 'active', 'plan', 'ntfy_topic', 'invited', 'created_at',
  'user_id', 'title', 'description', 'appointment_label', 'duration_minutes', 'buffer_before', 'buffer_after',
  'min_notice_minutes', 'max_bookings_per_day', 'location', 'location_type', 'webhook_url', 'custom_fields',
  'requires_confirmation', 'day_of_week', 'start_time', 'end_time', 'uid', 'event_type_id', 'attendee_name',
  'attendee_email', 'attendee_timezone', 'status', 'notes', 'custom_responses', 'cancel_token', 'reschedule_token',
  'confirm_token', 'google_event_id', 'reason', 'token', 'expires_at', 'used', 'owner_user_id', 'org_id', 'role',
  'routing', 'last_assigned_index', 'team_id', 'priority', 'source', 'source_ref', 'sla_due_at', 'sla_breached',
  'customer_token', 'customer_email', 'customer_name', 'lat', 'lng', 'location_name', 'assignee_id', 'ticket_id',
  'joined_at', 'last_seen', 'author_name', 'author_email', 'body', 'is_staff', 'type', 'accuracy', 'image_url',
  'note', 'meta', 'severity', 'fired_at', 'acked_at', 'resolved_at', 'device_id', 'endpoint', 'subscription_json',
  'updated_at', 'provider', 'access_token', 'refresh_token', 'calendar_email', 'risk_level', 'discount_flag',
  'flagged_by', 'company', 'message', 'submitted_at', 'ticket_subject_template', 'ticket_from_prefix',
  'site_address', 'site_notes', 'scheduled_start', 'scheduled_end', 'started_at', 'completed_at', 'booking_id',
  'work_order_id', 'entry_type', 'ended_at', 'duration_minutes', 'sort_order', 'required', 'completed',
  'completed_at', 'completed_by', 'sku', 'quantity', 'unit', 'unit_cost', 'url', 'filename', 'mime_type',
  'caption', 'category', 'uploaded_by', 'role', 'signer_name', 'signed_at', 'ip_hash',
]);

function col(name) {
  const n = name === 'Id' ? 'id' : name;
  if (!ALLOWED_COLUMNS.has(n)) throw new Error(`Invalid column: ${name}`);
  return n;
}

function parseValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === '' || raw === 'null') return null;
  const num = Number(raw);
  if (raw !== '' && !Number.isNaN(num) && /^-?\d+(\.\d+)?$/.test(raw)) return num;
  return raw;
}

const OP_SQL = {
  eq: '=',
  ne: '<>',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
  like: 'LIKE',
};

export function parseWhere(where) {
  if (!where) return { clause: 'TRUE', params: [] };
  const params = [];
  const parts = String(where).split('~and').map(s => s.trim()).filter(Boolean);
  const clauses = parts.map(part => {
    const m = part.match(/^\(([^,]+),([^,]+),([\s\S]*)\)$/);
    if (!m) throw new Error(`Invalid where clause: ${part}`);
    const field = col(m[1].trim());
    const op = m[2].trim();
    const value = parseValue(m[3].trim());
    if (value === null && op === 'eq') {
      return `${field} IS NULL`;
    }
    if (value === null && op === 'ne') {
      return `${field} IS NOT NULL`;
    }
    const sqlOp = OP_SQL[op];
    if (!sqlOp) throw new Error(`Unsupported operator: ${op}`);
    params.push(value);
    return `${field} ${sqlOp} $${params.length}`;
  });
  return { clause: clauses.join(' AND '), params };
}

export function parseSort(sort) {
  if (!sort) return 'id DESC';
  const desc = String(sort).startsWith('-');
  const field = col(desc ? sort.slice(1) : sort);
  return `${field} ${desc ? 'DESC' : 'ASC'}`;
}

export const ALLOWED_TABLES = new Set([
  'users', 'event_types', 'availability', 'bookings', 'blocked_times', 'magic_links', 'sessions',
  'organizations', 'org_members', 'teams', 'team_members', 'team_event_types', 'tickets',
  'ticket_responders', 'ticket_replies', 'signals', 'alerts', 'crosses', 'push_subscriptions',
  'calendar_connections', 'client_flags', 'leads',
  'work_orders', 'work_order_incidents', 'work_order_time_entries', 'work_order_checklist_items',
  'work_order_line_items', 'work_order_attachments', 'work_order_signatures',
]);

export function assertTable(table) {
  if (!ALLOWED_TABLES.has(table)) throw new Error(`Invalid table: ${table}`);
}
