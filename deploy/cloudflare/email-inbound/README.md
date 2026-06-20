# Inbound email → SchedKit tickets

Routes `support@projectseven.us` (or any address) to SchedKit via Email Routing + this Worker.

## Prerequisites

- SchedKit deployed with `PORTAL_INBOUND_SECRET` set (same secret everywhere)
- Cloudflare Email Routing enabled for `projectseven.us`
- `wrangler` CLI logged in

## Deploy worker

```bash
cd deploy/cloudflare/email-inbound
npm init -y   # optional, wrangler only needs wrangler.toml + src/
npx wrangler secret put PORTAL_INBOUND_SECRET
npx wrangler deploy
```

## Wire Email Routing

Cloudflare Dashboard → **Email** → **Email Routing** → **Routing rules**

| Field | Value |
|-------|--------|
| Custom address | `support@projectseven.us` |
| Action | Send to a Worker |
| Worker | `p7-support-inbound` |

## SchedKit endpoint

`POST /v1/portal/inbound/ticket`

Header: `X-Portal-Inbound-Secret: <PORTAL_INBOUND_SECRET>`

Body:

```json
{
  "org_slug": "projectseven",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "subject": "Help with hosting",
  "message": "…",
  "source": "email",
  "source_ref": "<message-id>",
  "department_slug": "technical",
  "priority": "normal"
}
```

## Contact form

`projectseven.us/contact.php` uses the same endpoint with `source: api` and `department_slug: sales`.

Set on Plesk (or host env):

```
PORTAL_INBOUND_SECRET=<same as SchedKit>
SCHEDKIT_URL=https://schedkit.net
```

## Reply threading (later)

Outbound ticket emails should include `[P7-{public_code}]` in the subject so the worker can strip it and attach replies to existing tickets.
