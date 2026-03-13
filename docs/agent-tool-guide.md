# SchedKit Agent Tool Guide

> **API-FirstResponder — Signal anything. Coordinate everything.**

SchedKit is built for agents. Atomic REST endpoints, API-key auth, zero session state. Your agent can check availability, create bookings, list them, and cancel them — all without any UI, OAuth dance, or server-side session to manage.

This guide gets you from zero to a working tool-calling agent in one read.

---

## Base URL & Auth

```
Base URL:  https://schedkit.net
Auth:      x-api-key: YOUR_API_KEY   (header, every request)
```

All requests and responses are JSON. No cookies. No sessions. Every call is self-contained.

---

## Core Endpoints

### GET /v1/availability

Check open time slots for an event type on a given date.

```
GET /v1/availability?event_type_id=<id>&date=YYYY-MM-DD
```

**Query params:**

| Param | Type | Required | Description |
|---|---|---|---|
| `event_type_id` | string | ✅ | ID of the event type (e.g. `"evt_123"`) |
| `date` | string | ✅ | Date in `YYYY-MM-DD` format |
| `timezone` | string | ❌ | IANA timezone (e.g. `"America/Chicago"`). Defaults to UTC. |

**Response:**
```json
{
  "date": "2026-03-20",
  "event_type_id": "evt_123",
  "slots": [
    { "start_time": "2026-03-20T14:00:00Z", "end_time": "2026-03-20T14:30:00Z" },
    { "start_time": "2026-03-20T15:00:00Z", "end_time": "2026-03-20T15:30:00Z" }
  ]
}
```

---

### POST /v1/bookings

Create a booking. Always call `/v1/availability` first — don't guess at slots.

```
POST /v1/bookings
Content-Type: application/json
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `event_type_id` | string | ✅ | Event type to book |
| `attendee_name` | string | ✅ | Full name of the attendee |
| `attendee_email` | string | ✅ | Email of the attendee |
| `start_time` | string | ✅ | ISO 8601 datetime (from availability response) |
| `notes` | string | ❌ | Optional notes from the attendee |
| `timezone` | string | ❌ | Attendee's IANA timezone |

**Response:**
```json
{
  "id": "bkg_abc456",
  "status": "confirmed",
  "event_type_id": "evt_123",
  "attendee_name": "Jane Doe",
  "attendee_email": "jane@example.com",
  "start_time": "2026-03-20T14:00:00Z",
  "end_time": "2026-03-20T14:30:00Z",
  "notes": "Quick sync to review Q2 plan",
  "requires_confirmation": false
}
```

If `status` is `"pending"`, the host has `requires_confirmation` enabled. The booking is registered but not confirmed until they approve it. Tell the user.

---

### GET /v1/bookings

List bookings. Useful for agents that need to surface existing bookings or check for conflicts.

```
GET /v1/bookings
```

**Optional query params:** `event_type_id`, `status` (`confirmed` | `pending` | `cancelled`), `from`, `to` (ISO 8601 dates).

**Response:**
```json
{
  "bookings": [
    {
      "id": "bkg_abc456",
      "status": "confirmed",
      "attendee_name": "Jane Doe",
      "start_time": "2026-03-20T14:00:00Z"
    }
  ]
}
```

---

### DELETE /v1/bookings/:id

Cancel a booking.

```
DELETE /v1/bookings/bkg_abc456
```

**Response:**
```json
{
  "id": "bkg_abc456",
  "status": "cancelled"
}
```

---

## Tool Definitions

Copy-paste ready definitions for Claude and OpenAI. Define all four tools; your agent will pick the right one based on context.

### Claude (Anthropic API — `tool_use` format)

```json
[
  {
    "name": "check_availability",
    "description": "Get available time slots for a SchedKit event type on a specific date. Always call this before creating a booking.",
    "input_schema": {
      "type": "object",
      "properties": {
        "event_type_id": {
          "type": "string",
          "description": "The SchedKit event type ID to check availability for."
        },
        "date": {
          "type": "string",
          "description": "Date to check in YYYY-MM-DD format."
        },
        "timezone": {
          "type": "string",
          "description": "IANA timezone string for the attendee, e.g. 'America/New_York'. Optional but recommended."
        }
      },
      "required": ["event_type_id", "date"]
    }
  },
  {
    "name": "create_booking",
    "description": "Create a booking on SchedKit. Use a start_time value returned from check_availability.",
    "input_schema": {
      "type": "object",
      "properties": {
        "event_type_id": {
          "type": "string",
          "description": "The event type to book."
        },
        "attendee_name": {
          "type": "string",
          "description": "Full name of the person being booked."
        },
        "attendee_email": {
          "type": "string",
          "description": "Email address of the attendee."
        },
        "start_time": {
          "type": "string",
          "description": "ISO 8601 start time from the availability response."
        },
        "notes": {
          "type": "string",
          "description": "Optional notes or agenda from the attendee."
        },
        "timezone": {
          "type": "string",
          "description": "IANA timezone string for the attendee."
        }
      },
      "required": ["event_type_id", "attendee_name", "attendee_email", "start_time"]
    }
  },
  {
    "name": "list_bookings",
    "description": "List existing SchedKit bookings. Optionally filter by event type, status, or date range.",
    "input_schema": {
      "type": "object",
      "properties": {
        "event_type_id": {
          "type": "string",
          "description": "Filter by event type ID."
        },
        "status": {
          "type": "string",
          "enum": ["confirmed", "pending", "cancelled"],
          "description": "Filter by booking status."
        },
        "from": {
          "type": "string",
          "description": "Start of date range (ISO 8601)."
        },
        "to": {
          "type": "string",
          "description": "End of date range (ISO 8601)."
        }
      },
      "required": []
    }
  },
  {
    "name": "cancel_booking",
    "description": "Cancel an existing SchedKit booking by its ID.",
    "input_schema": {
      "type": "object",
      "properties": {
        "booking_id": {
          "type": "string",
          "description": "The ID of the booking to cancel (e.g. 'bkg_abc456')."
        }
      },
      "required": ["booking_id"]
    }
  }
]
```

---

### OpenAI (GPT function-calling — `functions` format)

```json
[
  {
    "name": "check_availability",
    "description": "Get available time slots for a SchedKit event type on a specific date. Always call this before creating a booking.",
    "parameters": {
      "type": "object",
      "properties": {
        "event_type_id": {
          "type": "string",
          "description": "The SchedKit event type ID to check availability for."
        },
        "date": {
          "type": "string",
          "description": "Date to check in YYYY-MM-DD format."
        },
        "timezone": {
          "type": "string",
          "description": "IANA timezone string for the attendee, e.g. 'America/Chicago'. Optional but recommended."
        }
      },
      "required": ["event_type_id", "date"]
    }
  },
  {
    "name": "create_booking",
    "description": "Create a booking on SchedKit. Use a start_time value returned from check_availability.",
    "parameters": {
      "type": "object",
      "properties": {
        "event_type_id": {
          "type": "string",
          "description": "The event type to book."
        },
        "attendee_name": {
          "type": "string",
          "description": "Full name of the person being booked."
        },
        "attendee_email": {
          "type": "string",
          "description": "Email address of the attendee."
        },
        "start_time": {
          "type": "string",
          "description": "ISO 8601 start time from the availability response."
        },
        "notes": {
          "type": "string",
          "description": "Optional notes or agenda from the attendee."
        },
        "timezone": {
          "type": "string",
          "description": "IANA timezone string for the attendee."
        }
      },
      "required": ["event_type_id", "attendee_name", "attendee_email", "start_time"]
    }
  },
  {
    "name": "list_bookings",
    "description": "List existing SchedKit bookings. Optionally filter by event type, status, or date range.",
    "parameters": {
      "type": "object",
      "properties": {
        "event_type_id": {
          "type": "string",
          "description": "Filter by event type ID."
        },
        "status": {
          "type": "string",
          "enum": ["confirmed", "pending", "cancelled"],
          "description": "Filter by booking status."
        },
        "from": {
          "type": "string",
          "description": "Start of date range (ISO 8601)."
        },
        "to": {
          "type": "string",
          "description": "End of date range (ISO 8601)."
        }
      },
      "required": []
    }
  },
  {
    "name": "cancel_booking",
    "description": "Cancel an existing SchedKit booking by its ID.",
    "parameters": {
      "type": "object",
      "properties": {
        "booking_id": {
          "type": "string",
          "description": "The ID of the booking to cancel."
        }
      },
      "required": ["booking_id"]
    }
  }
]
```

---

## Example Agent Flow

**Scenario:** A user asks an AI assistant: *"Book me a 30-minute call with the sales team for next Thursday. My email is jane@example.com."*

The agent knows the event type ID from context or a prior lookup. Here's the full exchange.

---

**Step 1 — Agent checks availability**

Agent calls `check_availability`:

```json
{
  "event_type_id": "evt_123",
  "date": "2026-03-19",
  "timezone": "America/Chicago"
}
```

SchedKit responds:

```json
{
  "date": "2026-03-19",
  "event_type_id": "evt_123",
  "slots": [
    { "start_time": "2026-03-19T14:00:00Z", "end_time": "2026-03-19T14:30:00Z" },
    { "start_time": "2026-03-19T15:30:00Z", "end_time": "2026-03-19T16:00:00Z" },
    { "start_time": "2026-03-19T17:00:00Z", "end_time": "2026-03-19T17:30:00Z" }
  ]
}
```

---

**Step 2 — Agent picks a slot and creates the booking**

Agent selects the first available slot and calls `create_booking`:

```json
{
  "event_type_id": "evt_123",
  "attendee_name": "Jane Doe",
  "attendee_email": "jane@example.com",
  "start_time": "2026-03-19T14:00:00Z",
  "notes": "Intro call — user requested via AI assistant",
  "timezone": "America/Chicago"
}
```

SchedKit responds:

```json
{
  "id": "bkg_xyz789",
  "status": "confirmed",
  "event_type_id": "evt_123",
  "attendee_name": "Jane Doe",
  "attendee_email": "jane@example.com",
  "start_time": "2026-03-19T14:00:00Z",
  "end_time": "2026-03-19T14:30:00Z",
  "notes": "Intro call — user requested via AI assistant",
  "requires_confirmation": false
}
```

---

**Step 3 — Agent confirms to the user**

> ✅ Booked. You're on for **Thursday, March 19 at 9:00 AM CST** (30 min). A confirmation has been sent to jane@example.com. Booking ID: `bkg_xyz789`.

---

### Handling `requires_confirmation`

If the host has approval enabled, the response looks like this:

```json
{
  "id": "bkg_xyz789",
  "status": "pending",
  "requires_confirmation": true,
  ...
}
```

The booking is registered. The host needs to approve it before it's confirmed. Tell the user:

> ⏳ Your request is submitted. The host reviews bookings manually — you'll get a confirmation email once they approve it.

Don't tell the user the meeting is confirmed when status is `"pending"`.

---

## Best Practices

**Always check availability before booking.**  
Don't infer or guess at open slots from prior context. Availability is dynamic. Call the endpoint.

**Pass the user's timezone.**  
It's optional in the API but you should always include it. Slots come back in UTC — without timezone context, the host can't localize for the attendee.

**Trust the API for rules enforcement.**  
Booking limits, buffer times, blackout dates, max bookings per day — all enforced server-side. Your agent doesn't need to replicate that logic. If a slot isn't returned by `/v1/availability`, it's not available. If `POST /v1/bookings` returns an error, surface it to the user.

**Handle errors cleanly.**  
A `409 Conflict` means the slot was taken between your availability check and booking attempt. Re-check and offer the next available slot. A `422 Unprocessable Entity` means bad input — check required fields.

**Don't double-book.**  
If your agent is booking on behalf of a specific attendee email, consider calling `GET /v1/bookings` first to check if they already have an upcoming booking for the same event type.

**Use booking IDs for cancellations.**  
Store or surface `booking.id` after creation. That's what you need for `DELETE /v1/bookings/:id`.

---

## Quick Reference

| Action | Method | Endpoint |
|---|---|---|
| Check availability | `GET` | `/v1/availability?event_type_id=X&date=YYYY-MM-DD` |
| Create booking | `POST` | `/v1/bookings` |
| List bookings | `GET` | `/v1/bookings` |
| Cancel booking | `DELETE` | `/v1/bookings/:id` |

Auth header on every request: `x-api-key: YOUR_API_KEY`

---

*SchedKit API questions? → [api@schedkit.net](mailto:api@schedkit.net)*
