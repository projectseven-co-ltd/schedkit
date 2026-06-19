-- Project Seven client portal: clients, contacts, departments, ticket extensions

CREATE TABLE IF NOT EXISTS clients (
  id               BIGSERIAL PRIMARY KEY,
  org_id           TEXT NOT NULL,
  company_name     TEXT NOT NULL,
  slug             TEXT,
  blesta_client_id INTEGER UNIQUE,
  status           TEXT DEFAULT 'active',
  plan_tier        TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clients_org_id ON clients (org_id);
CREATE INDEX IF NOT EXISTS idx_clients_blesta ON clients (blesta_client_id);
CREATE INDEX IF NOT EXISTS idx_clients_slug ON clients (slug);

CREATE TABLE IF NOT EXISTS client_domains (
  id         BIGSERIAL PRIMARY KEY,
  client_id  BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  domain     TEXT NOT NULL,
  UNIQUE (domain)
);
CREATE INDEX IF NOT EXISTS idx_client_domains_client ON client_domains (client_id);

CREATE TABLE IF NOT EXISTS client_contacts (
  id                BIGSERIAL PRIMARY KEY,
  client_id         BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email             TEXT NOT NULL,
  name              TEXT,
  is_primary        BOOLEAN DEFAULT false,
  blesta_contact_id INTEGER,
  user_id           TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, email)
);
CREATE INDEX IF NOT EXISTS idx_client_contacts_email ON client_contacts (lower(email));
CREATE INDEX IF NOT EXISTS idx_client_contacts_user ON client_contacts (user_id);

CREATE TABLE IF NOT EXISTS ticket_departments (
  id          BIGSERIAL PRIMARY KEY,
  org_id      TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  slug        TEXT,
  active      BOOLEAN DEFAULT true,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_departments_org ON ticket_departments (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_departments_org_slug ON ticket_departments (org_id, slug);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS department_id TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS public_code TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_tickets_client_id ON tickets (client_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_public_code ON tickets (public_code)
  WHERE public_code IS NOT NULL;

-- Default departments for Project Seven org (when org slug exists)
INSERT INTO ticket_departments (org_id, name, description, slug, sort_order)
SELECT o.id::text, v.name, v.description, v.slug, v.sort_order
FROM organizations o
CROSS JOIN (VALUES
  ('Technical Support', 'Hosting, server, and technical issues', 'technical', 1),
  ('Billing',           'Invoices, payments, and account billing', 'billing', 2),
  ('Sales',             'New services, upgrades, and general inquiries', 'sales', 3)
) AS v(name, description, slug, sort_order)
WHERE o.slug = 'projectseven'
  AND NOT EXISTS (
    SELECT 1 FROM ticket_departments d
    WHERE d.org_id = o.id::text AND d.slug = v.slug
  );
