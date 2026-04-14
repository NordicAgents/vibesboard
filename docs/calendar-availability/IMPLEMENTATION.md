# Calendar Availability Tool — Implementation

## Overview

Allows an agent to check Google Calendar for date-range availability (check-in / check-out).
Distinct from the scheduling feature (which books meetings by time slot) — this is for
resource/accommodation availability: "Is Glass Cabin free May 10–14?"

---

## Files

### Backend

| File | Purpose |
|---|---|
| `lib/agent/tools/calendar-availability.ts` | Tool definition + executor. Calls Google Calendar `/freeBusy` API |
| `lib/agent/context-builder.ts` | Injects tool into toolkit when `calendarAvailabilityConfig.enabled` |
| `lib/agent/prompts.ts` | `getCalendarAvailabilityInstructions()` — injected into system prompt when enabled |
| `app/api/scheduling/connections/[id]/calendars/route.ts` | `GET` — lists all Google Calendars for a connection (for UI dropdown) |

### Types & Schema

| File | Change |
|---|---|
| `lib/firestore-types.ts` | `AgentCalendarAvailabilityConfig` interface + field on `AgentDocument` |
| `lib/types.ts` | `calendarAvailabilityConfig` on `VibeAgent` |
| `lib/agents/schema.ts` | `calendarAvailabilityConfigSchema` + added to `upsertAgentSchema` |
| `lib/agents/db.ts` | `mapAgentDoc` maps `calendarAvailabilityConfig` from Firestore |

### Frontend

| File | Purpose |
|---|---|
| `components/agents/agent-calendar-availability-settings.tsx` | Settings UI: connect calendar, pick calendar from dropdown, enable toggle, resource name |
| `components/agents/agent-dashboard-tabs.tsx` | "Availability" sub-tab added to Actions tab |
| `lib/hooks/use-agent-form.ts` | `calendarAvailabilityConfig` state, setter, change detection, save payload |

---

## Config Shape

Stored on the agent document at `calendarAvailabilityConfig`:

```ts
{
  enabled: boolean               // master toggle
  calendarConnectionId: string | null  // which OAuth connection to use
  calendarId: string | null      // specific calendar within that account
  resourceName: string           // e.g. "Glass Cabin" — used in responses
}
```

`calendarId` overrides the default calendar stored on the connection.
Falls back to `connection.calendarId` if not set.

---

## OAuth

Reuses the existing Google Calendar OAuth flow at `/api/scheduling/auth/google`.
Same `calendar_connections` Firestore collection.
Scopes: `calendar`, `calendar.events`, `userinfo.email`.

Token auto-refresh is handled by `getValidAccessToken()` in `lib/scheduling/connections.ts`.

Feature flag required: `AGENT_ACTIONS_SCHEDULE` (same as scheduling).

---

## How the Tool Works

```
Tool: check_calendar_availability(check_in: string, check_out: string)

1. Validate date formats (YYYY-MM-DD)
2. Validate check_out > check_in
3. getValidAccessToken(connection)  ← auto-refreshes if expired
4. POST /freeBusy to Google Calendar API
     timeMin: check_in at 00:00 UTC
     timeMax: check_out at 00:00 UTC
     calendarId: config.calendarId ?? connection.calendarId
5. If busy slots = 0  → "Glass Cabin is available May 10–14 (4 nights)"
   If busy slots > 0  → "Glass Cabin is NOT available... X conflicting bookings"
```

---

## System Prompt Injection

When `enabled: true`, `getCalendarAvailabilityInstructions()` appends to the system prompt:

```
## Availability Checking
You have access to the check_calendar_availability tool. Use it whenever
a user asks about availability, free dates, or whether they can book {resourceName}.

RULES:
- Always call the tool — never guess
- Convert vague dates ("next weekend") to YYYY-MM-DD first
- If only check-in given, ask for check-out before calling
- Respond naturally — don't expose raw tool output
- If unavailable, suggest different dates
```

This is what makes the tool reliably discovered and used by the model.

---

## User Flow (Agent Owner Setup)

1. Actions tab → Availability
2. Connect Google Calendar (OAuth)
3. Select calendar from dropdown (e.g. "Glass Cabin Bookings")
4. Toggle enable ON
5. Set resource name (e.g. "Glass Cabin")
6. Save

---

## Customer Conversation Flow

```
Customer: "Is Glass Cabin free May 10–14?"
    ↓
Model reads system prompt → knows to call check_calendar_availability
    ↓
Tool calls Google Calendar /freeBusy
    ↓
Returns available / unavailable
    ↓
Model responds naturally to customer
```

---

## Tool Scaling Note

Tools and their system prompt instructions are only injected when enabled.
An agent with `calendarAvailabilityConfig.enabled = false` gets zero overhead.

If the number of enabled tools per agent grows large (10+), consider:
- Capping tools per agent at save time (schema-level)
- Intent-based tool routing (classify message → inject relevant tools only)

---

## Difference vs Scheduling Feature

| | Scheduling | Calendar Availability |
|---|---|---|
| Use case | Book a meeting slot | Check if dates are free |
| Input | Date + duration | check_in + check_out |
| Output | Available time slots | Available / not available |
| Google API | freeBusy (slot generation) | freeBusy (date range check) |
| Stores bookings | Yes (Firestore) | No — read-only |
| Tools | check_availability, book_meeting, reschedule, cancel | check_calendar_availability only |
