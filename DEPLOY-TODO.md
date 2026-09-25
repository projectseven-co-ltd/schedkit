# Portal + tickets — deploy when ready

**Code is done and pushed.** Nothing left to write unless you want reply-by-email threading later.

You only need ~15 minutes on servers when you have energy. I can't access Portainer/Plesk/Cloudflare from here.

---

## One secret (use the same value everywhere)

```bash
openssl rand -hex 32
```

Call it `PORTAL_INBOUND_SECRET` below.

---

## Checklist

### SchedKit (Portainer)

- [ ] Pull latest `main` and **redeploy** the API container
- [ ] Env vars set:
  - `PORTAL_ORG_SLUG=projectseven`
  - `PORTAL_INBOUND_SECRET=<secret from above>`
  - `PLATFORM_ADMIN_EMAILS=your@email` (org bootstrap)
  - **Do not set** `PORTAL_COOKIE_DOMAIN` (portal uses PHP proxy)
- [ ] After deploy: open Incidents → Refresh → create a test ticket → it **stays** after refresh

### Portal (projectseven.us)

- [ ] GitHub Action **Build & Deploy** green on `main` (deploys portal + contact form)
- [ ] GitHub repo secret `PORTAL_INBOUND_SECRET` set (same value as SchedKit — deploy writes `schedkit.config.php`)
- [ ] Or manually: copy `schedkit.config.example.php` → `public_html/schedkit.config.php` on Plesk
- [ ] Test login at `/portal/` (user must exist in SchedKit — seed below)
- [ ] Test contact form on homepage → ticket shows in SchedKit Incidents

### Seed a portal login (once per client)

Run on SchedKit server (or locally with `DATABASE_URL`):

```bash
node scripts/seed-portal-client.mjs \
  --org-slug projectseven \
  --email YOU@projectseven.us \
  --name "Your Name" \
  --company "Your Company" \
  --password 'pick-a-password'
```

### Email → tickets (optional, later)

- [ ] `cd deploy/cloudflare/email-inbound && npx wrangler secret put PORTAL_INBOUND_SECRET && npx wrangler deploy`
- [ ] Cloudflare Email Routing: `support@projectseven.us` → worker `p7-support-inbound`

Details: [deploy/cloudflare/email-inbound/README.md](deploy/cloudflare/email-inbound/README.md)

---

## Not doing now

- Billing/invoices in SchedKit (Blesta still handles billing until you cut it over)
- Reply-by-email threading (`[P7-code]` in subject)
- Blesta column cleanup in DB

---

## If something breaks

| Symptom | Check |
|---------|--------|
| Portal login fails | User seeded? SchedKit up? `schedkit.php` deployed? |
| Tickets vanish on Incidents | SchedKit redeployed with latest `main`? |
| Contact form 503 | `schedkit.config.php` missing or empty on Plesk (set GitHub secret `PORTAL_INBOUND_SECRET`) |
| Contact form 500 | Secret mismatch between Plesk and SchedKit |

Technical notes: [PORTAL-TICKETS-FIX.md](PORTAL-TICKETS-FIX.md)
