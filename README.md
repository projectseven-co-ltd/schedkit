# p7-scheduler

Lightweight API-first scheduling service. Think Cal.com but lean — built for embedding and white-labeling.

## Features

- **Event types** — define bookable sessions (30min call, 1hr consult, etc.)
- **Availability rules** — per-day working hours with timezone support
- **Booking engine** — conflict detection, cancel/reschedule tokens
- **Webhooks** — fire on booking created/cancelled
- **Multi-tenant** — each user gets an API key, public booking URLs under `/book/:slug/:event`
- **Postgres backend** — direct SQL via `DATABASE_URL` (Docker Compose locally, Plesk stack in prod)

## Stack

- Node.js + Fastify
- PostgreSQL 16
- date-fns + date-fns-tz (timezone math)
- Docker Compose (optional local/prod stack)

## Quick Start

```bash
cp .env.example .env
# Set API_SECRET; DATABASE_URL is pre-filled for docker compose Postgres
docker compose up --build
# API: http://localhost:3000  ·  Postgres host port: 5433
```

Bare Node (Postgres already running):

```bash
npm install
npm start
```

## API Reference

### Admin (requires `x-admin-secret` header)

```
POST /v1/users         — create a user (returns api_key)
GET  /v1/users         — list users
```

### Authenticated (requires `x-api-key` header)

```
GET/POST/PATCH/DELETE /v1/event-types
GET/PUT/DELETE        /v1/availability
GET                   /v1/bookings
```

### Public

```
GET  /v1/slots/:username/:event_slug?date=YYYY-MM-DD&timezone=America/Chicago
POST /v1/book/:username/:event_slug
POST /v1/cancel/:token
GET  /v1/u/:slug
GET  /health
```

## Example Flow

```bash
# 1. Create user
curl -X POST /v1/users -H "x-admin-secret: ..." \
  -d '{"name":"Jane","email":"jane@co.com","slug":"jane","timezone":"America/New_York"}'
# → { api_key: "p7s_..." }

# 2. Set availability (Mon–Fri 9-5)
for day in 1 2 3 4 5; do
  curl -X PUT /v1/availability -H "x-api-key: p7s_..." \
    -d "{\"day_of_week\":$day,\"start_time\":\"09:00\",\"end_time\":\"17:00\"}"
done

# 3. Create event type
curl -X POST /v1/event-types -H "x-api-key: p7s_..." \
  -d '{"title":"30min Call","slug":"30min","duration_minutes":30,"buffer_after":10}'

# 4. Get slots (public)
curl "/v1/slots/jane/30min?date=2026-03-10&timezone=America/Chicago"

# 5. Book (public)
curl -X POST /v1/book/jane/30min \
  -d '{"start_time":"2026-03-10T14:00:00Z","attendee_name":"Bob","attendee_email":"bob@example.com"}'
```

## Portainer auto-deploy (production)

Same pattern as [SignalForge hub](https://github.com/projectseven-co-ltd/p7-scanner): push to `main` builds `ghcr.io/projectseven-co-ltd/schedkit-api:<short-sha>`, then CI triggers your Portainer stack webhook with `IMAGE_TAG=<short-sha>`.

1. In [Portainer on Plesk](https://projectseven.io/modules/docker/portainer/) → **SchedKit stack** → **Webhooks** → copy the stack webhook URL.
2. GitHub → `projectseven-co-ltd/schedkit` → **Settings → Secrets → Actions** → add:
   - `SCHEDKIT_PORTAINER_STACK_WEBHOOK_URL` = your webhook URL (either format works; CI tries both):
     - `https://projectseven.io/modules/docker/portainer/api/stacks/webhooks/<uuid>`
     - `https://projectseven.io/api/stacks/webhooks/<uuid>`
3. Use a **SchedKit-specific** webhook — do not reuse `PORTAINER_STACK_WEBHOOK_URL` from SignalForge (different stack).
4. Stack compose file: `docker-compose.plesk.yml`. Enable pull/redeploy on webhook if Portainer asks.

Manual redeploy with a pinned tag:

```bash
IMAGE_TAG=abc1234 docker compose -f docker-compose.plesk.yml --env-file .env.production up -d
```
