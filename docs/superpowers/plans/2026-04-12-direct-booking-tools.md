# Direct Booking Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four agent tools (list, create, update, delete calendar events) so an owner can manage room bookings conversationally through the agent.

**Architecture:** Extend the existing `bookingConfig` with a `mode: 'direct'` option. Add Google Calendar Events API functions to the existing provider. Build a new `direct-booking.ts` tool file following the same patterns as `simple-booking.ts`. Wire into context-builder and prompt builder.

**Tech Stack:** TypeScript, Google Calendar API v3, Zod validation, React (UI config)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `lib/scheduling/providers/google-calendar.ts` | Add `listEvents()` — raw Google Calendar Events API call |
| `lib/agent/tools/direct-booking.ts` (new) | Four tool builders + helpers: list, create, update, delete |
| `lib/firestore-types.ts` | Extend `AgentBookingConfig` with new fields |
| `lib/types.ts` | Mirror `bookingConfig` changes in `VibeAgent` |
| `lib/agents/schema.ts` | Add Zod validation for new fields |
| `lib/agent/context-builder.ts` | Inject direct booking tools when `mode === 'direct'` |
| `lib/agent/prompts.ts` | Add booking management prompt section |
| `components/agents/agent-booking-resource-config.tsx` | Add mode selector, title template, event time mode, overlap toggle |

---

### Task 1: Extend Booking Config Types

**Files:**
- Modify: `lib/firestore-types.ts:50-57`
- Modify: `lib/types.ts:114-124`
- Modify: `lib/agents/schema.ts:96-99`

- [ ] **Step 1: Update `AgentBookingConfig` in firestore-types.ts**

In `lib/firestore-types.ts`, replace the `AgentBookingConfig` interface:

```typescript
export type BookingMode = 'enquiry' | 'direct'

export interface AgentBookingConfig {
  enabled: boolean
  resources: BookableResource[]
  mode?: BookingMode
  eventTitleTemplate?: string
  eventTimeMode?: 'all-day' | 'timed'
  overlapProtection?: boolean
}
```

- [ ] **Step 2: Update `bookingConfig` in VibeAgent type**

In `lib/types.ts`, replace the `bookingConfig` property on `VibeAgent`:

```typescript
  bookingConfig?: {
    enabled: boolean
    resources: Array<{
      id: string
      name: string
      calendarConnectionId: string
      calendarId: string
      calendarName: string
      timezone: string
    }>
    mode?: 'enquiry' | 'direct'
    eventTitleTemplate?: string
    eventTimeMode?: 'all-day' | 'timed'
    overlapProtection?: boolean
  }
```

- [ ] **Step 3: Update Zod schema validation**

In `lib/agents/schema.ts`, replace `bookingConfigSchema`:

```typescript
export const bookingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  resources: z.array(bookableResourceSchema).default([]),
  mode: z.enum(['enquiry', 'direct']).default('enquiry'),
  eventTitleTemplate: z.string().max(200).default('{guest_name} ({guest_count} guests)'),
  eventTimeMode: z.enum(['all-day', 'timed']).default('all-day'),
  overlapProtection: z.boolean().default(true)
})
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to bookingConfig types.

- [ ] **Step 5: Commit**

```bash
git add lib/firestore-types.ts lib/types.ts lib/agents/schema.ts
git commit -m "feat(direct-booking): extend bookingConfig with mode, title template, event time mode, overlap protection"
```

---

### Task 2: Add Google Calendar Events API Functions

**Files:**
- Modify: `lib/scheduling/providers/google-calendar.ts`

The existing `GoogleCalendarProvider` class already has `createEvent`, `updateEvent`, `deleteEvent` methods. But the direct-booking tools need standalone functions that work with raw access tokens (like `simple-booking.ts` does with `fetchBusySlots`). We'll add a `listCalendarEvents` function at the bottom of the file.

- [ ] **Step 1: Add `listCalendarEvents` function**

Add at the bottom of `lib/scheduling/providers/google-calendar.ts`, after the `getTimezoneOffset` function:

```typescript
// ─── Standalone Calendar Events API (used by direct-booking tools) ───

export interface CalendarEvent {
  id: string
  summary: string
  description?: string
  start: string  // ISO datetime or date
  end: string    // ISO datetime or date
  htmlLink?: string
}

/**
 * List events from a Google Calendar within a date range.
 * Returns parsed CalendarEvent objects sorted by start date.
 */
export async function listCalendarEvents(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: new Date(timeMin).toISOString(),
    timeMax: new Date(timeMax).toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250'
  })

  const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Calendar API error (${res.status}): ${text}`)
  }

  const data = await res.json()
  const items: any[] = data.items ?? []

  return items.map(item => ({
    id: item.id,
    summary: item.summary ?? '(no title)',
    description: item.description ?? '',
    start: item.start?.dateTime ?? item.start?.date ?? '',
    end: item.end?.dateTime ?? item.end?.date ?? '',
    htmlLink: item.htmlLink
  }))
}

/**
 * Create an event on a Google Calendar. Returns the created event.
 */
export async function createCalendarEvent(
  accessToken: string,
  calendarId: string,
  event: {
    summary: string
    description?: string
    start: { date?: string; dateTime?: string; timeZone?: string }
    end: { date?: string; dateTime?: string; timeZone?: string }
  }
): Promise<CalendarEvent> {
  const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(event)
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Calendar API error (${res.status}): ${text}`)
  }

  const item = await res.json()
  return {
    id: item.id,
    summary: item.summary ?? '',
    description: item.description ?? '',
    start: item.start?.dateTime ?? item.start?.date ?? '',
    end: item.end?.dateTime ?? item.end?.date ?? '',
    htmlLink: item.htmlLink
  }
}

/**
 * Update an event on a Google Calendar (PATCH).
 */
export async function updateCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  updates: {
    summary?: string
    description?: string
    start?: { date?: string; dateTime?: string; timeZone?: string }
    end?: { date?: string; dateTime?: string; timeZone?: string }
  }
): Promise<CalendarEvent> {
  const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updates)
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Calendar API error (${res.status}): ${text}`)
  }

  const item = await res.json()
  return {
    id: item.id,
    summary: item.summary ?? '',
    description: item.description ?? '',
    start: item.start?.dateTime ?? item.start?.date ?? '',
    end: item.end?.dateTime ?? item.end?.date ?? '',
    htmlLink: item.htmlLink
  }
}

/**
 * Delete an event from a Google Calendar.
 */
export async function deleteCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` }
  })

  if (!res.ok && res.status !== 410) {
    const text = await res.text()
    throw new Error(`Google Calendar API error (${res.status}): ${text}`)
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/scheduling/providers/google-calendar.ts
git commit -m "feat(direct-booking): add standalone Google Calendar Events API functions (list, create, update, delete)"
```

---

### Task 3: Build Direct Booking Agent Tools

**Files:**
- Create: `lib/agent/tools/direct-booking.ts`

This is the core task — four tool builders following the same patterns as `simple-booking.ts`.

- [ ] **Step 1: Create `lib/agent/tools/direct-booking.ts`**

```typescript
import { getCalendarConnection, getValidAccessToken } from '@/lib/scheduling/connections'
import {
  listCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent
} from '@/lib/scheduling/providers/google-calendar'
import type { CalendarConnectionDocument, BookableResource } from '@/lib/firestore-types'
import type { VibeAgent } from '@/lib/types'
import type { RegisteredTool } from './base'

// ─── Types ──────────────────────────────────────────────────────────

interface ResolvedResource {
  resource: BookableResource
  connection: CalendarConnectionDocument
  accessToken: string
}

// ─── Helpers ────────────────────────────────────────────────────────

async function resolveResource(
  agent: VibeAgent,
  resourceName: string
): Promise<ResolvedResource | null> {
  const resource = agent.bookingConfig!.resources.find(
    r => r.name.toLowerCase() === resourceName.toLowerCase()
  )
  if (!resource) return null

  const connection = await getCalendarConnection(agent.tenantId!, resource.calendarConnectionId)
  if (!connection) return null

  let accessToken: string
  try {
    accessToken = await getValidAccessToken(connection)
  } catch {
    return null
  }

  return { resource, connection, accessToken }
}

async function resolveAllResources(
  agent: VibeAgent
): Promise<ResolvedResource[]> {
  const results: ResolvedResource[] = []
  for (const resource of agent.bookingConfig!.resources) {
    const connection = await getCalendarConnection(agent.tenantId!, resource.calendarConnectionId)
    if (!connection) continue
    try {
      const accessToken = await getValidAccessToken(connection)
      results.push({ resource, connection, accessToken })
    } catch {
      continue
    }
  }
  return results
}

function buildTitle(template: string, guestName: string, guestCount: number): string {
  return template
    .replace('{guest_name}', guestName)
    .replace('{guest_count}', String(guestCount))
}

function buildDescription(guestName: string, guestCount: number): string {
  return `Guest: ${guestName}\nGuests: ${guestCount}`
}

function formatEventDate(dateStr: string, timezone: string): string {
  if (!dateStr) return 'unknown'
  try {
    // All-day events are just YYYY-MM-DD
    if (!dateStr.includes('T')) return dateStr
    return new Date(dateStr).toLocaleString('en-US', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  } catch {
    return dateStr
  }
}

// ─── Tool: list_calendar_events ────────────────────────────────────

function buildListEventsTool(agent: VibeAgent): RegisteredTool {
  const resourceNames = agent.bookingConfig!.resources.map(r => r.name).join(', ')

  return {
    function: {
      name: 'list_calendar_events',
      description:
        `List booking events from room calendars. Available rooms: ${resourceNames}. ` +
        `If resource_name is omitted, lists events across all rooms.`,
      parameters: {
        type: 'object',
        properties: {
          resource_name: {
            type: 'string',
            description: `Room name (optional). One of: ${resourceNames}. Omit to query all rooms.`
          },
          start_date: {
            type: 'string',
            description: 'Start of date range in YYYY-MM-DD format.'
          },
          end_date: {
            type: 'string',
            description: 'End of date range in YYYY-MM-DD format.'
          }
        },
        required: ['start_date', 'end_date']
      }
    },
    execute: async (args) => {
      const resourceName = args.resource_name ? String(args.resource_name).trim() : ''
      const startDate = String(args.start_date ?? '').trim()
      const endDate = String(args.end_date ?? '').trim()

      if (!startDate || !endDate) return 'start_date and end_date are required (YYYY-MM-DD).'

      // Resolve which resources to query
      let resources: ResolvedResource[]
      if (resourceName) {
        const resolved = await resolveResource(agent, resourceName)
        if (!resolved) return `Unknown room "${resourceName}". Available: ${resourceNames}.`
        resources = [resolved]
      } else {
        resources = await resolveAllResources(agent)
        if (resources.length === 0) return 'No calendar connections available.'
      }

      try {
        const allEvents: Array<{ room: string; id: string; title: string; start: string; end: string; description: string }> = []

        for (const { resource, accessToken } of resources) {
          const events = await listCalendarEvents(
            accessToken,
            resource.calendarId,
            `${startDate}T00:00:00`,
            `${endDate}T23:59:59`
          )
          for (const ev of events) {
            allEvents.push({
              room: resource.name,
              id: ev.id,
              title: ev.summary,
              start: formatEventDate(ev.start, resource.timezone),
              end: formatEventDate(ev.end, resource.timezone),
              description: ev.description ?? ''
            })
          }
        }

        if (allEvents.length === 0) {
          const scope = resourceName || 'all rooms'
          return `No bookings found for ${scope} between ${startDate} and ${endDate}.`
        }

        // Sort by start date
        allEvents.sort((a, b) => a.start.localeCompare(b.start))

        const lines = allEvents.map(ev =>
          `- [${ev.room}] ${ev.title} | ${ev.start} → ${ev.end} | Event ID: ${ev.id}${ev.description ? ` | ${ev.description}` : ''}`
        )
        return `Found ${allEvents.length} booking(s):\n${lines.join('\n')}`
      } catch (err) {
        return `Error listing events: ${err instanceof Error ? err.message : 'Unknown error'}`
      }
    }
  }
}

// ─── Tool: create_calendar_event ───────────────────────────────────

function buildCreateEventTool(agent: VibeAgent): RegisteredTool {
  const resourceNames = agent.bookingConfig!.resources.map(r => r.name).join(', ')
  const titleTemplate = agent.bookingConfig!.eventTitleTemplate ?? '{guest_name} ({guest_count} guests)'
  const timeMode = agent.bookingConfig!.eventTimeMode ?? 'all-day'
  const overlapProtection = agent.bookingConfig!.overlapProtection !== false

  return {
    function: {
      name: 'create_calendar_event',
      description:
        `Create a booking on a room's calendar. Available rooms: ${resourceNames}. ` +
        `Always confirm details with the owner before calling this tool.`,
      parameters: {
        type: 'object',
        properties: {
          resource_name: {
            type: 'string',
            description: `Room name. One of: ${resourceNames}.`
          },
          check_in_date: {
            type: 'string',
            description: 'Check-in date in YYYY-MM-DD format.'
          },
          check_out_date: {
            type: 'string',
            description: 'Check-out date in YYYY-MM-DD format.'
          },
          guest_name: {
            type: 'string',
            description: 'Full name of the guest.'
          },
          guest_count: {
            type: 'number',
            description: 'Number of guests.'
          }
        },
        required: ['resource_name', 'check_in_date', 'check_out_date', 'guest_name', 'guest_count']
      }
    },
    execute: async (args) => {
      const resourceName = String(args.resource_name ?? '').trim()
      const checkIn = String(args.check_in_date ?? '').trim()
      const checkOut = String(args.check_out_date ?? '').trim()
      const guestName = String(args.guest_name ?? '').trim()
      const guestCount = typeof args.guest_count === 'number' ? args.guest_count : 1

      if (!resourceName || !checkIn || !checkOut || !guestName) {
        return 'Missing required fields: resource_name, check_in_date, check_out_date, guest_name.'
      }
      if (checkOut <= checkIn) return 'check_out_date must be after check_in_date.'

      const resolved = await resolveResource(agent, resourceName)
      if (!resolved) return `Unknown room "${resourceName}". Available: ${resourceNames}.`

      const { resource, accessToken } = resolved

      try {
        // Check for overlaps
        if (overlapProtection) {
          const existing = await listCalendarEvents(
            accessToken,
            resource.calendarId,
            `${checkIn}T00:00:00`,
            `${checkOut}T23:59:59`
          )
          if (existing.length > 0) {
            const conflicts = existing.map(ev =>
              `- ${ev.summary} | ${formatEventDate(ev.start, resource.timezone)} → ${formatEventDate(ev.end, resource.timezone)}`
            ).join('\n')
            return `Cannot create booking — ${resource.name} has overlapping bookings:\n${conflicts}`
          }
        }

        const title = buildTitle(titleTemplate, guestName, guestCount)
        const description = buildDescription(guestName, guestCount)

        let startField: { date?: string; dateTime?: string; timeZone?: string }
        let endField: { date?: string; dateTime?: string; timeZone?: string }

        if (timeMode === 'all-day') {
          startField = { date: checkIn }
          endField = { date: checkOut }
        } else {
          startField = { dateTime: `${checkIn}T14:00:00`, timeZone: resource.timezone }
          endField = { dateTime: `${checkOut}T11:00:00`, timeZone: resource.timezone }
        }

        const created = await createCalendarEvent(accessToken, resource.calendarId, {
          summary: title,
          description,
          start: startField,
          end: endField
        })

        return (
          `Booking created for ${resource.name}:\n` +
          `- Title: ${created.summary}\n` +
          `- Check-in: ${checkIn}\n` +
          `- Check-out: ${checkOut}\n` +
          `- Guest: ${guestName} (${guestCount} guests)\n` +
          `- Event ID: ${created.id}`
        )
      } catch (err) {
        return `Error creating booking: ${err instanceof Error ? err.message : 'Unknown error'}`
      }
    }
  }
}

// ─── Tool: update_calendar_event ───────────────────────────────────

function buildUpdateEventTool(agent: VibeAgent): RegisteredTool {
  const resourceNames = agent.bookingConfig!.resources.map(r => r.name).join(', ')
  const titleTemplate = agent.bookingConfig!.eventTitleTemplate ?? '{guest_name} ({guest_count} guests)'
  const timeMode = agent.bookingConfig!.eventTimeMode ?? 'all-day'
  const overlapProtection = agent.bookingConfig!.overlapProtection !== false

  return {
    function: {
      name: 'update_calendar_event',
      description:
        `Update an existing booking event. Available rooms: ${resourceNames}. ` +
        `Use list_calendar_events first to find the event_id. ` +
        `Always confirm changes with the owner before calling this tool.`,
      parameters: {
        type: 'object',
        properties: {
          event_id: {
            type: 'string',
            description: 'Google Calendar event ID (from list_calendar_events).'
          },
          resource_name: {
            type: 'string',
            description: `Room name. One of: ${resourceNames}.`
          },
          check_in_date: {
            type: 'string',
            description: 'New check-in date in YYYY-MM-DD (optional).'
          },
          check_out_date: {
            type: 'string',
            description: 'New check-out date in YYYY-MM-DD (optional).'
          },
          guest_name: {
            type: 'string',
            description: 'New guest name (optional).'
          },
          guest_count: {
            type: 'number',
            description: 'New guest count (optional).'
          }
        },
        required: ['event_id', 'resource_name']
      }
    },
    execute: async (args) => {
      const eventId = String(args.event_id ?? '').trim()
      const resourceName = String(args.resource_name ?? '').trim()
      const checkIn = args.check_in_date ? String(args.check_in_date).trim() : undefined
      const checkOut = args.check_out_date ? String(args.check_out_date).trim() : undefined
      const guestName = args.guest_name ? String(args.guest_name).trim() : undefined
      const guestCount = typeof args.guest_count === 'number' ? args.guest_count : undefined

      if (!eventId || !resourceName) return 'event_id and resource_name are required.'

      const resolved = await resolveResource(agent, resourceName)
      if (!resolved) return `Unknown room "${resourceName}". Available: ${resourceNames}.`

      const { resource, accessToken } = resolved

      try {
        // Check for overlaps if dates are changing
        if (overlapProtection && checkIn && checkOut) {
          if (checkOut <= checkIn) return 'check_out_date must be after check_in_date.'
          const existing = await listCalendarEvents(
            accessToken,
            resource.calendarId,
            `${checkIn}T00:00:00`,
            `${checkOut}T23:59:59`
          )
          const conflicts = existing.filter(ev => ev.id !== eventId)
          if (conflicts.length > 0) {
            const lines = conflicts.map(ev =>
              `- ${ev.summary} | ${formatEventDate(ev.start, resource.timezone)} → ${formatEventDate(ev.end, resource.timezone)}`
            ).join('\n')
            return `Cannot update — new dates overlap with existing bookings:\n${lines}`
          }
        }

        const updates: Record<string, any> = {}

        if (guestName || guestCount !== undefined) {
          // Need to rebuild title — fetch current event to get existing values
          const currentEvents = await listCalendarEvents(
            accessToken,
            resource.calendarId,
            '2000-01-01T00:00:00',
            '2100-01-01T00:00:00'
          )
          const currentEvent = currentEvents.find(ev => ev.id === eventId)
          const currentName = guestName ?? (currentEvent?.summary ?? 'Guest')
          const currentCount = guestCount ?? 1
          updates.summary = buildTitle(titleTemplate, currentName, currentCount)
          updates.description = buildDescription(currentName, currentCount)
        }

        if (checkIn) {
          if (timeMode === 'all-day') {
            updates.start = { date: checkIn }
          } else {
            updates.start = { dateTime: `${checkIn}T14:00:00`, timeZone: resource.timezone }
          }
        }

        if (checkOut) {
          if (timeMode === 'all-day') {
            updates.end = { date: checkOut }
          } else {
            updates.end = { dateTime: `${checkOut}T11:00:00`, timeZone: resource.timezone }
          }
        }

        if (Object.keys(updates).length === 0) return 'No changes specified.'

        const updated = await updateCalendarEvent(accessToken, resource.calendarId, eventId, updates)

        return (
          `Booking updated for ${resource.name}:\n` +
          `- Title: ${updated.summary}\n` +
          `- Start: ${formatEventDate(updated.start, resource.timezone)}\n` +
          `- End: ${formatEventDate(updated.end, resource.timezone)}\n` +
          `- Event ID: ${updated.id}`
        )
      } catch (err) {
        return `Error updating booking: ${err instanceof Error ? err.message : 'Unknown error'}`
      }
    }
  }
}

// ─── Tool: delete_calendar_event ───────────────────────────────────

function buildDeleteEventTool(agent: VibeAgent): RegisteredTool {
  const resourceNames = agent.bookingConfig!.resources.map(r => r.name).join(', ')

  return {
    function: {
      name: 'delete_calendar_event',
      description:
        `Delete (cancel) a booking event. Available rooms: ${resourceNames}. ` +
        `Use list_calendar_events first to find the event_id. ` +
        `Always confirm with the owner before calling this tool.`,
      parameters: {
        type: 'object',
        properties: {
          event_id: {
            type: 'string',
            description: 'Google Calendar event ID (from list_calendar_events).'
          },
          resource_name: {
            type: 'string',
            description: `Room name. One of: ${resourceNames}.`
          }
        },
        required: ['event_id', 'resource_name']
      }
    },
    execute: async (args) => {
      const eventId = String(args.event_id ?? '').trim()
      const resourceName = String(args.resource_name ?? '').trim()

      if (!eventId || !resourceName) return 'event_id and resource_name are required.'

      const resolved = await resolveResource(agent, resourceName)
      if (!resolved) return `Unknown room "${resourceName}". Available: ${resourceNames}.`

      const { resource, accessToken } = resolved

      try {
        await deleteCalendarEvent(accessToken, resource.calendarId, eventId)
        return `Booking deleted from ${resource.name}. Event ID: ${eventId}`
      } catch (err) {
        return `Error deleting booking: ${err instanceof Error ? err.message : 'Unknown error'}`
      }
    }
  }
}

// ─── Feature entry point ─────────────────────────────────────────────

/**
 * Returns the four direct-booking tools when bookingConfig.mode === 'direct'.
 * Returns [] if disabled, no resources, or mode is not 'direct'.
 * Called by context-builder.
 */
export function buildDirectBookingTools(agent: VibeAgent): RegisteredTool[] {
  const config = agent.bookingConfig
  if (!config?.enabled || config.resources.length === 0) return []
  if (config.mode !== 'direct') return []

  return [
    buildListEventsTool(agent),
    buildCreateEventTool(agent),
    buildUpdateEventTool(agent),
    buildDeleteEventTool(agent)
  ]
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/agent/tools/direct-booking.ts
git commit -m "feat(direct-booking): add four agent tools — list, create, update, delete calendar events"
```

---

### Task 4: Wire Tools into Context Builder

**Files:**
- Modify: `lib/agent/context-builder.ts:1-11` (imports)
- Modify: `lib/agent/context-builder.ts:130-171` (booking tools injection)

- [ ] **Step 1: Add import for direct booking tools**

In `lib/agent/context-builder.ts`, add after the `buildSimpleBookingTools` import:

```typescript
import { buildDirectBookingTools } from './tools/direct-booking'
```

- [ ] **Step 2: Update booking tools injection logic**

In `lib/agent/context-builder.ts`, replace the booking/availability tools section (the block starting with `// Inject booking/availability tools` at line 130) with:

```typescript
  // Inject booking/availability tools — direct-booking, simple-booking, or legacy calendar-availability.
  // Only one set is registered to avoid tool name conflicts.
  if (agent.bookingConfig?.enabled && agent.tenantId) {
    try {
      const bookingEnabled = await isFeatureEnabled(agent.tenantId, 'AGENT_ACTIONS_BOOKING')
      if (bookingEnabled) {
        // Direct mode: owner CRUD tools. Enquiry mode: guest-facing tools.
        const bookingTools = agent.bookingConfig.mode === 'direct'
          ? buildDirectBookingTools(agent)
          : buildSimpleBookingTools(agent)
        for (const tool of bookingTools) {
          toolkit.functions.push(tool.function)
          toolkit.executors[tool.function.name] = tool.execute
        }
      }
    } catch (err) {
      console.error('Failed to inject booking tools:', err)
    }
  } else if (
    agent.calendarAvailabilityConfig?.enabled &&
    agent.calendarAvailabilityConfig.calendarConnectionId &&
    agent.tenantId
  ) {
    try {
      const scheduleEnabled = await isFeatureEnabled(
        agent.tenantId,
        'AGENT_ACTIONS_SCHEDULE'
      )
      if (scheduleEnabled) {
        const connection = await getCalendarConnection(
          agent.tenantId,
          agent.calendarAvailabilityConfig.calendarConnectionId
        )
        if (connection && connection.status === 'active') {
          const availabilityTools = buildCalendarAvailabilityTools(agent, connection)
          for (const tool of availabilityTools) {
            toolkit.functions.push(tool.function)
            toolkit.executors[tool.function.name] = tool.execute
          }
        }
      }
    } catch (err) {
      console.error('Failed to inject calendar availability tools:', err)
    }
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add lib/agent/context-builder.ts
git commit -m "feat(direct-booking): wire direct booking tools into context builder"
```

---

### Task 5: Add Booking Management System Prompt

**Files:**
- Modify: `lib/agent/prompts.ts`

- [ ] **Step 1: Add `getDirectBookingInstructions` function**

In `lib/agent/prompts.ts`, add after the `getCalendarAvailabilityInstructions` function (around line 242):

```typescript
function getDirectBookingInstructions(agent: VibeAgent): string {
  const config = agent.bookingConfig
  if (!config?.enabled || config.mode !== 'direct') return ''

  const resourceNames = config.resources.map(r => `${r.name} (${r.timezone})`).join(', ')

  return `
## Booking Management
You are a booking management assistant. The owner uses you to manage room bookings.

Available rooms: ${resourceNames}

RULES:
- Before creating, editing, or deleting any booking, summarize the action and ask "Shall I proceed?"
- When listing bookings, format them clearly: room name, dates, guest name, guest count
- When searching for a booking, match by guest name, room, date, or any combination the owner provides
- If a booking request overlaps with an existing one, refuse and show the conflicting booking details
- Display all dates in the room's configured timezone
- If the owner's request is ambiguous (e.g. "move the Smith booking" but multiple matches exist), list the matches and ask which one
- When the owner asks about availability or bookings without specifying a room, query all rooms

TOOL USAGE:
- list_calendar_events: Query bookings across rooms. Use when the owner asks about bookings, availability, or schedule.
- create_calendar_event: Create a new booking. Collect room, check-in, check-out, guest name, and guest count first. Confirm before creating.
- update_calendar_event: Edit a booking. Find it first with list_calendar_events, then confirm changes before updating.
- delete_calendar_event: Cancel a booking. Find it first with list_calendar_events, confirm before deleting.`
}
```

- [ ] **Step 2: Inject the instructions into the system prompt**

In the `buildAgentSystemPrompt` function, add the direct booking instructions. Find the line:

```typescript
  const calendarAvailabilityInstructions = getCalendarAvailabilityInstructions(agent)
```

Add after it:

```typescript
  const directBookingInstructions = getDirectBookingInstructions(agent)
```

Then in the template string where instructions are assembled, find:

```typescript
${calendarAvailabilityInstructions}
```

Add after it:

```typescript
${directBookingInstructions}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add lib/agent/prompts.ts
git commit -m "feat(direct-booking): add booking management instructions to system prompt"
```

---

### Task 6: Update Setup UI — Booking Mode & Config Fields

**Files:**
- Modify: `components/agents/agent-booking-resource-config.tsx`

- [ ] **Step 1: Update the component to include mode selector and config fields**

In `components/agents/agent-booking-resource-config.tsx`, make these changes:

First, update the `DEFAULT_CONFIG`:

```typescript
const DEFAULT_CONFIG: AgentBookingConfig = {
  enabled: false,
  resources: [],
  mode: 'enquiry',
  eventTitleTemplate: '{guest_name} ({guest_count} guests)',
  eventTimeMode: 'all-day',
  overlapProtection: true
}
```

Then, after the "Enable simple booking" Card (before the "Resources list" Card), add a new Card for booking mode and settings. Insert after the closing `</Card>` of the enable toggle section and before the `{/* Resources list */}` comment:

```tsx
      {/* Booking mode & settings */}
      {current.enabled && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Booking Mode</CardTitle>
            <CardDescription>
              Choose how the agent handles bookings.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Mode</label>
              <select
                value={current.mode ?? 'enquiry'}
                onChange={e => update({ mode: e.target.value as 'enquiry' | 'direct' })}
                disabled={disabled}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="enquiry">Enquiry — guests submit booking requests</option>
                <option value="direct">Direct — owner manages bookings via chat</option>
              </select>
            </div>

            {current.mode === 'direct' && (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Event title template</label>
                  <Input
                    placeholder="{guest_name} ({guest_count} guests)"
                    value={current.eventTitleTemplate ?? '{guest_name} ({guest_count} guests)'}
                    onChange={e => update({ eventTitleTemplate: e.target.value })}
                    disabled={disabled}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use {'{guest_name}'} and {'{guest_count}'} as placeholders.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Event time mode</label>
                  <select
                    value={current.eventTimeMode ?? 'all-day'}
                    onChange={e => update({ eventTimeMode: e.target.value as 'all-day' | 'timed' })}
                    disabled={disabled}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="all-day">All-day events (date only)</option>
                    <option value="timed">Timed events (2pm check-in, 11am check-out)</option>
                  </select>
                </div>

                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">Overlap protection</p>
                    <p className="text-xs text-muted-foreground">Block bookings that overlap with existing events</p>
                  </div>
                  <Switch
                    checked={current.overlapProtection !== false}
                    disabled={disabled}
                    onCheckedChange={overlapProtection => update({ overlapProtection })}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
```

Also update the description in the enable toggle Card to be mode-aware. Replace the `<CardDescription>`:

```tsx
          <CardDescription>
            {current.mode === 'direct'
              ? 'Manage room bookings directly through the agent via Google Calendar.'
              : 'Let guests check availability and submit booking enquiries via the agent. You\'ll receive an email with an .ics attachment for each enquiry.'}
          </CardDescription>
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add components/agents/agent-booking-resource-config.tsx
git commit -m "feat(direct-booking): add booking mode selector and direct-mode config fields to setup UI"
```

---

### Task 7: Verify Everything Compiles & Manual Test

- [ ] **Step 1: Full TypeScript check**

Run: `npx tsc --noEmit --pretty`
Expected: No errors.

- [ ] **Step 2: Run lint**

Run: `npx next lint 2>&1 | tail -20`
Expected: No new errors.

- [ ] **Step 3: Commit any fixes if needed**

If lint or type-check reveals issues, fix them and commit:

```bash
git add -A
git commit -m "fix(direct-booking): address lint/type-check issues"
```
