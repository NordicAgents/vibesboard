# Direct Booking Tools — Owner Assistant Agent

**Date:** 2026-04-12
**Status:** Approved
**Use Case:** Elam Resort — owner-facing agent for managing room bookings via Google Calendar

## Problem

Current booking tools are guest-facing: guests check availability and submit enquiries (Firestore documents), which the owner manually converts to calendar events. There is no way for the owner to manage bookings conversationally through the agent.

## Solution

Add a `direct` booking mode with four new agent tools that perform full CRUD on Google Calendar events. The owner chats with a password-gated agent to list, create, edit, and delete bookings across room calendars.

## Requirements

- Owner asks in natural language: "Show me bookings for next week", "Book Room 3 for John Smith, April 20-22, 3 guests"
- Agent confirms before any create/update/delete operation
- Strict overlap protection — no double bookings on the same room
- Search bookings by guest name, room, date, or any combination
- Query all rooms at once or a specific room
- Full CRUD: list, create, edit, delete calendar events

## Booking Data Model

Each booking captures:
- **Room name** (maps to a `BookableResource` / calendar)
- **Check-in date**
- **Check-out date**
- **Guest name**
- **Number of guests**

Stored as Google Calendar events on the room's linked calendar.

---

## New Agent Tools

### `list_calendar_events`

Lists events from one or all room calendars within a date range.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `resource_name` | string | No | Room name. If omitted, queries all rooms. |
| `start_date` | string | Yes | Start of range (YYYY-MM-DD) |
| `end_date` | string | Yes | End of range (YYYY-MM-DD) |

**Returns:** Array of events with: `event_id`, `resource_name`, `title`, `start`, `end`, `description`

**Behavior:**
- If `resource_name` omitted, iterates all `bookingConfig.resources` and merges results
- Uses Google Calendar Events API `GET /calendars/{calendarId}/events`
- Results sorted by start date

### `create_calendar_event`

Creates a booking event on the room's Google Calendar.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `resource_name` | string | Yes | Room name (must match a configured resource) |
| `check_in_date` | string | Yes | Check-in date (YYYY-MM-DD) |
| `check_out_date` | string | Yes | Check-out date (YYYY-MM-DD) |
| `guest_name` | string | Yes | Guest name |
| `guest_count` | number | Yes | Number of guests |

**Returns:** Created event details (event_id, title, dates)

**Behavior:**
1. Resolve `resource_name` to a `BookableResource` (calendar connection + calendar ID)
2. Call `checkOverlap()` — if conflict found, return error with conflicting event details
3. Build event title from `eventTitleTemplate` (e.g., `"{guest_name} ({guest_count} guests)"`)
4. Build event description with guest name, guest count
5. Create event via Google Calendar API `POST /calendars/{calendarId}/events`
6. Return confirmation

### `update_calendar_event`

Updates an existing booking event.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `event_id` | string | Yes | Google Calendar event ID |
| `resource_name` | string | Yes | Room name (to resolve calendar) |
| `check_in_date` | string | No | New check-in date |
| `check_out_date` | string | No | New check-out date |
| `guest_name` | string | No | New guest name |
| `guest_count` | number | No | New guest count |

**Returns:** Updated event details

**Behavior:**
1. Resolve resource to calendar
2. If dates changed, call `checkOverlap()` excluding the current event — reject if conflict
3. Rebuild title from template if guest name or count changed
4. Update via Google Calendar API `PATCH /calendars/{calendarId}/events/{eventId}`
5. Return updated details

### `delete_calendar_event`

Deletes a booking event from Google Calendar.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `event_id` | string | Yes | Google Calendar event ID |
| `resource_name` | string | Yes | Room name (to resolve calendar) |

**Returns:** Confirmation message

**Behavior:**
1. Resolve resource to calendar
2. Delete via Google Calendar API `DELETE /calendars/{calendarId}/events/{eventId}`
3. Return confirmation

---

## Google Calendar API Layer

New functions in `lib/scheduling/providers/google-calendar.ts`:

| Function | API Endpoint | Purpose |
|---|---|---|
| `listEvents(accessToken, calendarId, timeMin, timeMax)` | `GET /calendars/{id}/events` | List events in date range |
| `createEvent(accessToken, calendarId, event)` | `POST /calendars/{id}/events` | Create event |
| `updateEvent(accessToken, calendarId, eventId, updates)` | `PATCH /calendars/{id}/events/{eventId}` | Update event |
| `deleteEvent(accessToken, calendarId, eventId)` | `DELETE /calendars/{id}/events/{eventId}` | Delete event |
| `checkOverlap(accessToken, calendarId, startDate, endDate, excludeEventId?)` | Uses `listEvents()` | Check for conflicting events |

All functions use `getValidAccessToken()` for auto-refreshing OAuth tokens.

### Event Format

```typescript
{
  summary: string       // from eventTitleTemplate
  description: string   // guest details
  start: { date: string } | { dateTime: string }  // depends on eventTimeMode
  end: { date: string } | { dateTime: string }
}
```

- `eventTimeMode: 'all-day'` → uses `date` field (YYYY-MM-DD)
- `eventTimeMode: 'timed'` → uses `dateTime` field with resource timezone

---

## Booking Config Changes

Extended `bookingConfig` on the agent model:

```typescript
bookingConfig: {
  enabled: boolean
  resources: BookableResource[]        // existing — one per room

  // New fields
  mode: 'enquiry' | 'direct'          // enquiry = guest flow, direct = owner CRUD
  eventTitleTemplate: string           // default: "{guest_name} ({guest_count} guests)"
  eventTimeMode: 'all-day' | 'timed'  // how events appear in calendar
  overlapProtection: boolean           // block overlapping bookings
}
```

**Defaults:**
- `mode`: `'enquiry'` (backwards compatible)
- `eventTitleTemplate`: `"{guest_name} ({guest_count} guests)"`
- `eventTimeMode`: `'all-day'`
- `overlapProtection`: `true`

---

## Tool Injection Logic

In `lib/agent/context-builder.ts`, within the booking tools section:

```
if bookingConfig.enabled:
  if mode === 'direct':
    inject: list_calendar_events, create_calendar_event, update_calendar_event, delete_calendar_event
    inject: check_calendar_availability (existing, for quick availability checks)
  else (mode === 'enquiry'):
    inject: check_calendar_availability, submit_enquiry (existing behavior)
```

---

## System Prompt — Direct Booking Mode

When `bookingConfig.mode === 'direct'`, add to system prompt:

```
BOOKING MANAGEMENT INSTRUCTIONS:
You are a booking management assistant. The owner uses you to manage room bookings.

Rules:
- Before creating, editing, or deleting any booking, summarize the action and ask "Shall I proceed?"
- When listing bookings, format clearly: room name, dates, guest name, guest count
- When searching for a booking, match by guest name, room, date, or any combination the owner provides
- If a booking overlaps with an existing one, refuse and show the conflicting booking
- Display all dates in the resource's configured timezone
- If the owner's request is ambiguous (e.g., "move the Smith booking" but there are two), list the matches and ask which one

Available tools:
- list_calendar_events: Query bookings across rooms. Use when owner asks about bookings, availability, or schedule.
- create_calendar_event: Create a new booking. Collect room, dates, guest name, guest count first.
- update_calendar_event: Edit a booking. Find it first with list_calendar_events, then confirm changes.
- delete_calendar_event: Cancel a booking. Find it first, confirm before deleting.
```

---

## File Changes Summary

| Area | File | Change |
|---|---|---|
| Google Calendar API | `lib/scheduling/providers/google-calendar.ts` | Add `listEvents()`, `createEvent()`, `updateEvent()`, `deleteEvent()`, `checkOverlap()` |
| New agent tools | `lib/agent/tools/direct-booking.ts` (new) | Four tools: list, create, update, delete with tool definitions + executors |
| Tool injection | `lib/agent/context-builder.ts` | Inject direct booking tools when `mode === 'direct'` |
| Agent types | `lib/types.ts` | Add `mode`, `eventTitleTemplate`, `eventTimeMode`, `overlapProtection` to `BookingConfig` |
| Firestore types | `lib/firestore-types.ts` | Mirror type changes |
| System prompt | `lib/agent/prompts.ts` | Add booking assistant instructions for direct mode |
| Setup UI | `components/agents/agent-booking-resource-config.tsx` | Add mode selector, title template input, time mode toggle, overlap toggle |
| Validation | `lib/agents/schema.ts` | Validate new bookingConfig fields |

## What Stays Unchanged

- Google OAuth flow, calendar connections, resource config (rooms to calendars)
- Password gate for owner-only access
- Chat UI, streaming, conversation storage
- Enquiry mode (`mode: 'enquiry'`) — fully backwards compatible
- Existing `check_calendar_availability` tool

## No New Infrastructure

- No new Firestore collections
- No new services or servers
- No new OAuth scopes (calendar read/write already granted)
- No new environment variables
