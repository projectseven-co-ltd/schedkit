# Portal tickets — SchedKit-only cutover

**Status:** Blesta integration removed (2026-06-19). Portal auth + tickets are SchedKit-only.

## Incidents page fix (2026-06-19)

Portal-created tickets were disappearing on the staff Incidents page because:

1. **List query only checked one org** — `GET /v1/tickets` used the user's first org, missing tickets from other orgs (e.g. `projectseven`).
2. **Invalid sort column** — list used `-CreatedAt` but Postgres column is `created_at` (could 500 the list endpoint).
3. **SSE payload shape** — live updates sometimes lacked normalized `Id`, so merge + refresh dropped rows.

**Fix:** `listStaffTickets()` merges tickets by `user_id` + all owned/member orgs; sort uses `created_at`; SSE broadcasts full normalized rows.

## What changed

### SchedKit
- Removed `blestaBridge.mjs`, `blestaApi.mjs`, `import-blesta-clients.mjs`
- Portal auth is SchedKit password login only (`/v1/portal/auth/login`)
- Staff ticket list filters by **org_id** (not just `user_id`) so portal-created tickets stay visible
- Portal contact lookup prefers **primary** contact when multiple rows match

### projectseven.us portal
- Removed `blesta.php`, `auth_helper.php`, `portal_bridge.php`, `internal_invoice_helper.php`
- `api.js` → SchedKit only via `schedkit.php`
- Nav trimmed to Dashboard + Tickets (billing pages removed until SchedKit owns billing)

## Deploy checklist

1. **SchedKit** — redeploy API with `PORTAL_ORG_SLUG=projectseven` set
2. **Seed portal users** (if not already):
   ```bash
   node scripts/seed-portal-client.mjs \
     --org-slug projectseven \
     --email client@example.com \
     --name "Client Name" \
     --company "Company" \
     --password 'their-password'
   ```
3. **Portal** — `npm install && npm run build`, deploy `dist/` + `public/api/schedkit.php`
4. Leave `PORTAL_COOKIE_DOMAIN` **unset** on SchedKit when using the PHP proxy

## Still TODO

- Billing/invoices/services in SchedKit (Blesta retiring from site soon)
- Email reply threading (`[P7-{code}]` in subject → append reply to existing ticket)
- Optional: drop legacy `blesta_client_id` columns from DB when migration complete

## Inbound tickets (2026-06-19)

- `POST /v1/portal/inbound/ticket` — contact form + Cloudflare Email Worker
- Env: `PORTAL_INBOUND_SECRET` (SchedKit + contact.php + Worker)
- Deploy docs: `deploy/cloudflare/email-inbound/README.md`
