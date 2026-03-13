# SchedKit API & URL Reference

All API endpoints are at `https://schedkit.net`. API keys go in `x-api-key` header.  
Admin-only endpoints require `x-admin-secret` header.  
Session endpoints accept a `sk_session` cookie (web dashboard).

Interactive docs: `https://schedkit.net/docs`

---

## Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/auth/magic` | — | Request magic link login email |
| `GET` | `/v1/auth/verify` | — | Verify magic link token, set session |
| `GET` | `/v1/auth/me` | session/key | Get current user profile |
| `PATCH` | `/v1/auth/me` | session/key | Update profile (name, email, timezone, ntfy_topic) |
| `POST` | `/v1/auth/logout` | session | Destroy session |
| `GET` | `/v1/auth/google/connect` | session | Start Google Calendar OAuth flow |
| `GET` | `/v1/auth/google/callback` | — | Google OAuth callback |

---

## Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/v1/settings` | session/key | Get user settings (ntfy_topic, plan, email) |
| `PATCH` | `/v1/settings` | session/key | Update settings. `ntfy_topic`: slug `[a-zA-Z0-9_-]{1,64}` or empty to clear |

---

## Event Types

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/v1/event-types` | key | List user's event types |
| `POST` | `/v1/event-types` | key | Create event type |
| `GET` | `/v1/event-types/:id` | key | Get event type |
| `PATCH` | `/v1/event-types/:id` | key | Update event type |
| `DELETE` | `/v1/event-types/:id` | key | Delete event type |

---

## Availability

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/v1/availability` | key | List availability rules |
| `POST` | `/v1/availability` | key | Create availability rule |
| `PATCH` | `/v1/availability/:id` | key | Update availability rule |
| `DELETE` | `/v1/availability/:id` | key | Delete availability rule |

---

## Bookings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/v1/bookings` | key | List bookings (filter: status, from, to) |
| `GET` | `/v1/bookings/:id` | key | Get booking |
| `POST` | `/v1/bookings/:id/reschedule` | key | Reschedule a booking |
| `GET` | `/v1/bookings/:confirm_token/confirm` | — | Confirm pending booking (host action via email link) |
| `GET` | `/v1/bookings/:confirm_token/decline` | — | Decline pending booking (host action via email link) |

---

## Blackout Dates

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/v1/blackout` | key | List blackout rules |
| `POST` | `/v1/blackout` | key | Create blackout rule |
| `DELETE` | `/v1/blackout/:id` | key | Delete blackout rule |

---

## Clients (Risk Flags)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/v1/clients` | key | List flagged clients |
| `POST` | `/v1/clients/:email/flag` | key | Flag a client (caution/high-risk/blocked) |
| `GET` | `/v1/clients/:email/flag` | key | Get flag for email |
| `DELETE` | `/v1/clients/:email/flag` | key | Remove flag |

---

## Calendar

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/v1/calendar/status` | key | Google Calendar connection status |
| `DELETE` | `/v1/calendar/disconnect` | key | Disconnect Google Calendar |

---

## Notifications

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/notifications/test` | key | Send test ntfy.sh push notification |

---

## Organizations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/v1/orgs` | key | List orgs user belongs to |
| `POST` | `/v1/orgs` | key | Create org |
| `GET` | `/v1/orgs/:org_slug` | key | Get org |
| `PATCH` | `/v1/orgs/:org_slug` | key | Update org |
| `DELETE` | `/v1/orgs/:org_slug` | key | Delete org |
| `POST` | `/v1/orgs/:org_slug/invite` | key | Invite member by email |
| `POST` | `/v1/orgs/:org_slug/members` | key | Add member |
| `PATCH` | `/v1/orgs/:org_slug/members/:user_id` | key | Update member role |
| `DELETE` | `/v1/orgs/:org_slug/members/:user_id` | key | Remove member |
| `GET` | `/v1/orgs/:org_slug/teams` | key | List teams |
| `POST` | `/v1/orgs/:org_slug/teams` | key | Create team |
| `PATCH` | `/v1/orgs/:org_slug/teams/:team_slug` | key | Update team |
| `DELETE` | `/v1/orgs/:org_slug/teams/:team_slug` | key | Delete team |
| `GET` | `/v1/orgs/:org_slug/teams/:team_slug/members` | key | List team members |
| `POST` | `/v1/orgs/:org_slug/teams/:team_slug/members` | key | Add team member |
| `PATCH` | `/v1/orgs/:org_slug/teams/:team_slug/members/:user_id` | key | Update team member |
| `DELETE` | `/v1/orgs/:org_slug/teams/:team_slug/members/:user_id` | key | Remove team member |
| `GET` | `/v1/orgs/:org_slug/teams/:team_slug/event-types` | key | List team event types |
| `POST` | `/v1/orgs/:org_slug/teams/:team_slug/event-types` | key | Create team event type |
| `PATCH` | `/v1/orgs/:org_slug/teams/:team_slug/event-types/:et_slug` | key | Update team event type |
| `DELETE` | `/v1/orgs/:org_slug/teams/:team_slug/event-types/:et_slug` | key | Delete team event type |

---

## Tickets / Incidents

Tickets and incidents are the **same object** — every record is accessible via both `/v1/tickets` (async/helpdesk) and the real-time `/v1/incidents` layer. Same NocoDB row, same ID, same fields.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/v1/tickets` | key | List tickets/incidents (filter: status, priority) |
| `POST` | `/v1/tickets` | key | Create ticket/incident. Triggers per-user ntfy push if priority is urgent/high or source is alert |
| `GET` | `/v1/tickets/:id` | key | Get ticket/incident |
| `PATCH` | `/v1/tickets/:id` | key | Update ticket/incident (status, priority, location, etc.) |
| `DELETE` | `/v1/tickets/:id` | key | Delete ticket/incident |
| `GET` | `/v1/incidents/:id/replies` | key/session | List reply thread for incident |
| `POST` | `/v1/incidents/:id/replies` | key/session | Post reply to incident thread |
| `POST` | `/v1/incidents/:id/join` | key/session | Join incident as responder |
| `POST` | `/v1/incidents/:id/leave` | key/session | Leave incident as responder |
| `PATCH` | `/v1/incidents/:id/responders/location` | key/session | Update responder GPS position |

---

## Users (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/users` | admin | Create user account |
| `GET` | `/v1/users` | admin | List all users |
| `GET` | `/v1/u/:slug` | — | Get public user profile |

---

## Public (Booking / Slots)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/v1/slots/:username/:event_slug` | — | Get available booking slots |
| `GET` | `/v1/slots/:org_slug/:team_slug/:event_slug` | — | Get team booking slots |
| `GET` | `/v1/cancel/:token` | — | Get cancellation details |
| `POST` | `/v1/cancel/:token` | — | Cancel booking via token |
| `POST` | `/v1/cancel/:token/confirm` | — | Confirm cancellation |
| `GET` | `/v1/reschedule/:token` | — | Get reschedule details |
| `POST` | `/v1/reschedule/:token` | — | Submit reschedule via token |

---

## SSE Streams

Real-time Server-Sent Events. Connect and keep the connection open — events are pushed as JSON.

### Authenticated Ops Stream
```
GET /v1/incidents/stream?api_key=YOUR_KEY
```
Requires API key as query param (SSE can't set headers from browser). Streams all incident events to authenticated staff:
- `incident.created` — new ticket/incident
- `incident.updated` — status/priority/field changes
- `incident.reply` — new reply posted
- `responder.joined` / `responder.left` — responder roster changes
- `responder.location` — real-time GPS position update

### Public Customer Stream
```
GET /v1/incidents/:token/public-stream
```
No auth — token is the `customer_token` from the incident. Streams updates for that specific incident to the customer status page. Events: `incident.updated`.

---

## Web UI Pages

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/dashboard` | session | Main dashboard — event types, bookings, availability, settings |
| `GET` | `/incidents/war-room` | session | Real-time ops war room — SSE-powered incident board |
| `GET` | `/incidents/status/:token` | — | Customer-facing status page for a specific incident (magic link) |
| `GET` | `/book/:username/:event_slug` | — | Individual booking page |
| `GET` | `/book/:org_slug/:team_slug/:event_slug` | — | Team booking page |

---

## Embed / SDK — `@schedkit/react`

Install:
```bash
npm install @schedkit/react
```

### Inline embed
Renders the booking calendar directly in the page.
```jsx
import { ScheduleInline } from '@schedkit/react';

<ScheduleInline host="yourslug" event="30min" />
```

### Popup
Opens the booking flow in a modal overlay.
```jsx
import { SchedulePopup } from '@schedkit/react';

<SchedulePopup host="yourslug" event="30min">
  <button>Book a call</button>
</SchedulePopup>
```

### Widget
Floating button + popup — drop it in a corner, zero layout impact.
```jsx
import { ScheduleWidget } from '@schedkit/react';

<ScheduleWidget host="yourslug" event="30min" />
```

All modes accept `host` (user slug or org/team path), `event` (event type slug), and `onBookingComplete` callback.

---

## Push Notifications (ntfy.sh)

Users can set their own `ntfy_topic` via `PATCH /v1/settings`. When an incident is created with priority `urgent` or `high`, or source `alert`, a push notification is sent to their topic.

```
POST https://ntfy.sh/{ntfy_topic}
Title: <ticket title>
Priority: urgent | high | default
Tags: <source field>
Body: <description, truncated to 200 chars>
```

Subscribe in the [ntfy app](https://ntfy.sh) to your topic to receive notifications on iOS/Android.
