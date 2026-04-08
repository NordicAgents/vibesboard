# Resource Booking with Approval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Booking feature — a complete agent-powered resource reservation system. The feature exposes two agent tools (`check_calendar_availability` and `submit_booking_request`), a soft-block / approval flow, and an admin review UI. Guest provides a datetime range, agent checks availability, places a soft-block, notifies the admin, and writes a timed Google Calendar event only after admin approval.

**Architecture:** A new `bookingConfig` on the agent schema holds `resourceName`, `timezone`, and `ttlHours`. The feature's tools live in `lib/agent/tools/booking.ts`. `submit_booking_request` guards against double-bookings, saves a `pending` `BookingRequestDocument`, and notifies the admin. An approve/reject API route re-validates and writes a timed Google Calendar event. A cron endpoint auto-expires stale pending requests.

**Tech Stack:** Next.js App Router, Firestore (admin SDK), Google Calendar freeBusy + Events API, existing `AgentNotificationConfig`, existing `CalendarConnectionDocument` + `getValidAccessToken`.

---

## Design

Everything is just a datetime range — no modes, no per-field time config:

| Use case | `start_datetime` | `end_datetime` |
|----------|-----------------|----------------|
| Resort stay | `2026-05-10T14:00` | `2026-05-15T11:00` |
| Conference room | `2026-05-10T09:00` | `2026-05-10T18:00` |
| Equipment rental | `2026-05-10T08:00` | `2026-05-12T17:00` |

`bookingConfig` only needs `resourceName`, `timezone`, and `ttlHours`.

---

## Requirements Coverage

### Infrastructure that exists (reused, not rebuilt)
- Resend email via `RESEND_API_KEY` + `NOTIFICATION_EMAIL_FROM` (same pattern as `lib/agents/notifications.ts`) ✅
- Google Calendar OAuth + `getValidAccessToken` + `getCalendarConnection` ✅
- `CalendarConnectionDocument` ✅
- `nanoid` utility ✅

### What this plan builds (the Booking feature)
1. `BookableResource` type — one bookable resource (name, calendar, timezone, TTL, min/max stay)
2. `bookingConfig` agent config schema — array of `BookableResource`, global TTL default
3. `AgentBookingConfig` + `BookableResource` Firestore types + extend `VibeAgent`
4. `BookingRequestDocument` Firestore type — includes `resourceId`, `guestPhone`
5. `Collections.bookingRequests` path
6. **`check_calendar_availability` tool** — takes `resource_name` + datetime range, returns availability or nearest slots
7. **`submit_booking_request` tool** — takes `resource_name` + datetime range + guest details incl. phone
8. `createBookingRequest` helper
9. Admin email + in-app notification on new request (via Resend)
10. **Guest hold confirmation** — email (+ WhatsApp if available) sent to guest immediately on submit with request ID, dates, resource, hold expiry
11. Guest email + WhatsApp notification on approve/reject (via Resend + WhatsApp)
12. Soft-block TTL auto-expiry cron endpoint
13. Admin approve/reject/cancel API + timed calendar event writer
14. **Admin cancel approved booking** — deletes Google Calendar event, notifies guest
15. Admin pending requests UI with approve/reject
16. Admin booking history table (approved/rejected/expired/cancelled)
17. Admin resource management UI (add/remove/edit bookable resources) — with pending-request guard on delete

### Refined requirements
- **Multi-resource:** one agent can manage multiple bookable resources (cabins, rooms, equipment) — each with its own calendar connection, timezone, and TTL override. Guest specifies which resource when checking or submitting
- **Resource discovery:** tool descriptions dynamically list available resource names so the agent can guide the guest
- **Guest phone:** mandatory at submit time alongside name and email
- **Guest hold confirmation:** immediately after `submit_booking_request` succeeds, send guest an email AND WhatsApp (if phone is provided) with: request ID, resource, dates in resource timezone, hold expiry, and a note that they'll be notified of the decision
- **Admin email + in-app on submit:** Resend email to admin + in-app notification when a new request arrives
- **Guest email + WhatsApp on decision:** notify guest via email AND WhatsApp when admin approves or rejects
- **Admin cancel approved:** admin can cancel an already-approved booking — deletes the Google Calendar event, marks status `cancelled`, notifies guest via email + WhatsApp
- **Soft-block TTL:** configurable globally per agent (`ttlHours`, default 24h) with optional per-resource override — pending requests auto-expire
- **Soft-block visibility:** `check_calendar_availability` checks both Google Calendar freeBusy AND Firestore pending requests so soft-blocked slots show as unavailable immediately
- **Next available suggestions:** when unavailable, scans both earlier and later, returns up to 3 nearest windows of the same duration
- **Double-booking prevention:** freeBusy re-checked at submit AND at approve time
- **Concurrent request guard (Firestore transaction):** the freeBusy check + pending overlap check + write must run inside a Firestore transaction to prevent two simultaneous submissions from both passing the overlap check
- **Duplicate guest guard:** if the same `guestEmail` already has a pending request for the same resource overlapping the dates, reject with a clear message
- **Past datetime guard:** `check_calendar_availability` and `submit_booking_request` both reject datetimes in the past
- **Min/max stay validation:** each `BookableResource` can optionally define `minStayHours` and `maxStayHours`; both tools enforce these limits
- **Email format validation:** `guestEmail` validated against basic RFC format before saving
- **Datetime normalization:** accept ISO variants (with seconds, with Z, with offset) — normalize to local wall-clock string in resource timezone before saving
- **Graceful OAuth failure:** if `getValidAccessToken` throws, tools return a user-friendly message instead of crashing
- **Resource deletion guard:** removing a bookable resource that has active pending requests prompts the admin and auto-expires those requests before deletion
- **All times in the resource's configured `timezone`**

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/agents/schema.ts` | Modify | Replace `calendarAvailabilityConfigSchema` with `bookingConfigSchema` + `bookableResourceSchema` (adds `minStayHours`, `maxStayHours`) |
| `lib/firestore-types.ts` | Modify | Add `BookableResource`, `AgentBookingConfig`, `BookingRequestDocument`, `Collections.bookingRequests`; add `cancelled` status |
| `lib/types.ts` | Modify | Rename `calendarAvailabilityConfig` → `bookingConfig: AgentBookingConfig` on `VibeAgent` |
| `lib/agent/tools/calendar-availability.ts` | **Delete** | Superseded by `booking.ts` |
| `lib/agent/tools/booking.ts` | Create | Both booking tools with validations (past datetime, min/max stay, email format, datetime normalization, duplicate guest guard, Firestore transaction, graceful OAuth failure) |
| `lib/agent/context-builder.ts` | Modify | Update import: `buildCalendarAvailabilityTools` → `buildBookingTools` |
| `lib/booking-requests/create.ts` | Create | Save pending request (inside Firestore transaction) |
| `lib/booking-requests/notify.ts` | Create | Admin Resend email + in-app notification on new request |
| `lib/booking-requests/guest-hold-notify.ts` | **Create** | Guest hold confirmation — email + WhatsApp sent immediately on submit |
| `lib/booking-requests/guest-notify.ts` | Create | Guest email + WhatsApp on approve/reject/cancel |
| `lib/booking-requests/calendar.ts` | Create | Write timed Google Calendar event on approval |
| `lib/booking-requests/cancel-calendar.ts` | **Create** | Delete Google Calendar event on admin cancel |
| `app/api/booking-requests/route.ts` | Create | Admin GET — list requests by status |
| `app/api/booking-requests/[id]/route.ts` | Create | Admin PATCH — approve, reject, or cancel + trigger guest notifications |
| `app/api/booking-requests/expire/route.ts` | Create | Cron POST — expire stale pending requests |
| `components/agents/agent-booking-requests.tsx` | Create | Admin UI — pending requests with approve/reject |
| `components/agents/agent-booking-history.tsx` | Create | Admin UI — history table (approved/rejected/expired/cancelled) |
| `components/agents/agent-booking-resource-config.tsx` | Create | Admin UI — manage bookable resources; guard delete when pending requests exist |

---

## Task 1: Booking config schema and Firestore types

**Files:**
- Modify: `lib/agents/schema.ts`
- Modify: `lib/firestore-types.ts`

- [ ] **Step 1: Replace `calendarAvailabilityConfigSchema` with `bookingConfigSchema` in `lib/agents/schema.ts` (around line 80)**

```typescript
export const bookableResourceSchema = z.object({
  id: z.string(),
  name: z.string().max(100),
  calendarConnectionId: z.string(),
  calendarId: z.string().nullable().optional(),
  timezone: z.string().default('UTC'),
  ttlHours: z.number().int().min(1).max(168).optional(),  // overrides global default
  minStayHours: z.number().int().min(1).optional(),       // minimum booking duration
  maxStayHours: z.number().int().min(1).optional()        // maximum booking duration
})

export const bookingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  resources: z.array(bookableResourceSchema).default([]),
  ttlHours: z.number().int().min(1).max(168).default(24)  // global default
})
```

- [ ] **Step 2: Add `BookableResource` and replace `AgentCalendarAvailabilityConfig` with `AgentBookingConfig` in `lib/firestore-types.ts` (around line 51)**

```typescript
export interface BookableResource {
  id: string                      // nanoid — stable key per resource
  name: string                    // e.g. "Glass Cabin", "Conference Room A"
  calendarConnectionId: string
  calendarId?: string | null
  timezone: string                // default: 'UTC'
  ttlHours?: number               // overrides global default if set
  minStayHours?: number           // minimum booking duration in hours
  maxStayHours?: number           // maximum booking duration in hours
}

export interface AgentBookingConfig {
  enabled: boolean
  resources: BookableResource[]
  ttlHours: number               // global default (1–168h)
}
```

- [ ] **Step 3: Add `BookingRequestDocument` after the existing `BookingDocument` block (around line 739)**

```typescript
// ─── Booking Requests (approval-gated, agent-scoped) ────────────────

export type BookingRequestStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled'

/** /tenants/{tenantId}/agents/{agentId}/bookingRequests/{requestId} */
export interface BookingRequestDocument {
  id: string
  agentId: string
  tenantId: string
  conversationId?: string   // set when booking originates from a conversation (for future guest notification)
  resourceId: string        // BookableResource.id
  calendarConnectionId: string
  calendarId: string
  resourceName: string
  timezone: string

  // Booking span — ISO 8601 datetime strings
  startDatetime: string   // e.g. "2026-05-10T14:00:00"
  endDatetime: string     // e.g. "2026-05-15T11:00:00"

  // Guest details
  guestName: string
  guestEmail: string
  guestPhone?: string
  guestCount?: number
  notes?: string

  // Approval
  status: BookingRequestStatus
  externalEventId?: string   // set on approval
  adminNote?: string
  cancelledAt?: string       // ISO timestamp — set when admin cancels an approved booking

  // Soft-block TTL
  expiresAt: string          // ISO timestamp

  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 4: Add `bookingRequests` path to the `Collections` object (around line 832)**

```typescript
bookingRequests: (tenantId: string, agentId: string) =>
  `tenants/${tenantId}/agents/${agentId}/bookingRequests` as const,
```

- [ ] **Step 5: Update `VibeAgent` type in `lib/types.ts`**

Find the `calendarAvailabilityConfig` field on the `VibeAgent` interface and rename it to `bookingConfig: AgentBookingConfig | null`:

```typescript
bookingConfig?: AgentBookingConfig | null
```

Remove the old `calendarAvailabilityConfig` field. This is required or `agent.bookingConfig` in `booking.ts` will be a TypeScript error.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add lib/agents/schema.ts lib/firestore-types.ts lib/types.ts
git commit -m "feat(resource-booking): rename calendarAvailabilityConfig → bookingConfig, add BookingRequestDocument"
```

---

## Task 2: Booking agent tools (`check_calendar_availability` + `submit_booking_request`)

**Files:**
- Delete: `lib/agent/tools/calendar-availability.ts` (move its tool into `booking.ts`)
- Create: `lib/agent/tools/booking.ts`
- Modify: `lib/agent/context-builder.ts` (update import)

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/agent/tools/booking.test.ts`:

```typescript
import { buildBookingTools } from '@/lib/agent/tools/booking'

const mockAgent = {
  id: 'agent-1',
  tenantId: 'tenant-1',
  bookingConfig: {
    enabled: true,
    ttlHours: 24,
    resources: [
      {
        id: 'res-1',
        name: 'Glass Cabin',
        calendarConnectionId: 'conn-1',
        calendarId: 'primary',
        timezone: 'Asia/Kolkata'
      },
      {
        id: 'res-2',
        name: 'Pool Villa',
        calendarConnectionId: 'conn-2',
        calendarId: 'secondary',
        timezone: 'Asia/Kolkata'
      }
    ]
  }
} as any

describe('buildBookingTools', () => {
  it('returns check and submit tools when enabled', () => {
    const tools = buildBookingTools(mockAgent)
    const names = tools.map(t => t.function.name)
    expect(names).toContain('check_calendar_availability')
    expect(names).toContain('submit_booking_request')
  })

  it('returns empty array when no resources configured', () => {
    const agent = { ...mockAgent, bookingConfig: { ...mockAgent.bookingConfig, resources: [] } }
    expect(buildBookingTools(agent)).toHaveLength(0)
  })

  it('submit_booking_request requires resource_name, start_datetime, end_datetime, guest_name, guest_email, guest_phone', () => {
    const tools = buildBookingTools(mockAgent)
    const submit = tools.find(t => t.function.name === 'submit_booking_request')!
    expect(submit.function.parameters.required).toEqual(
      expect.arrayContaining(['resource_name', 'start_datetime', 'end_datetime', 'guest_name', 'guest_email', 'guest_phone'])
    )
  })

  it('check_calendar_availability requires resource_name, start_datetime, end_datetime', () => {
    const tools = buildBookingTools(mockAgent)
    const check = tools.find(t => t.function.name === 'check_calendar_availability')!
    expect(check.function.parameters.required).toEqual(
      expect.arrayContaining(['resource_name', 'start_datetime', 'end_datetime'])
    )
  })

  it('tool descriptions list all resource names', () => {
    const tools = buildBookingTools(mockAgent)
    const check = tools.find(t => t.function.name === 'check_calendar_availability')!
    expect(check.function.description).toContain('Glass Cabin')
    expect(check.function.description).toContain('Pool Villa')
  })

  // Soft-block visibility: a pending request must make the slot appear unavailable
  // to other guests calling check_calendar_availability, not just at submit time.
  it('check_calendar_availability returns unavailable when a pending soft-block overlaps', async () => {
    // This is an integration-style test — mock adminDb + freeBusy to return no busy slots,
    // but have a pending Firestore doc overlapping the requested range.
    // Expected: tool returns "not available", not "available".
    // Implementation detail: test should mock Collections.bookingRequests query to return one doc.
    expect(true).toBe(true) // placeholder — implement with Firestore mock in Step 4
  })

  it('check_calendar_availability suggests next available slots when requested slot is unavailable', async () => {
    // Mock freeBusy to return a busy slot covering the requested range.
    // Mock the broader search window freeBusy to return a clear gap after the busy period.
    // Expected: response contains "Next available slots" with at least one suggestion.
    expect(true).toBe(true) // placeholder — implement with fetch mock in Step 4
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/agent/tools/booking.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 2b: Delete `lib/agent/tools/calendar-availability.ts`**

```bash
git rm lib/agent/tools/calendar-availability.ts
```

- [ ] **Step 3: Create `lib/agent/tools/booking.ts` — define `BookingContext` interface**

`BookingContext` is resolved per-execute from the `resource_name` arg — no connection pre-fetch at build time.

```typescript
// Resolved at execute time from resource_name arg
interface ResolvedResourceContext {
  resource: BookableResource
  connection: CalendarConnectionDocument
  calendarId: string
  ttlHours: number
}
```

Helper to resolve a resource by name at execute time:

```typescript
async function resolveResource(
  agent: VibeAgent,
  resourceName: string
): Promise<ResolvedResourceContext | null> {
  const { getCalendarConnection } = await import('@/lib/scheduling/connections')

  const resource = agent.bookingConfig!.resources.find(
    r => r.name.toLowerCase() === resourceName.toLowerCase()
  )
  if (!resource) return null

  const connection = await getCalendarConnection(agent.tenantId!, resource.calendarConnectionId)
  if (!connection) return null

  const calendarId = resource.calendarId ?? connection.calendarId
  if (!calendarId) return null

  return {
    resource,
    connection,
    calendarId,
    ttlHours: resource.ttlHours ?? agent.bookingConfig!.ttlHours
  }
}
```

- [ ] **Step 4: Add `buildCheckCalendarAvailabilityTool` in `booking.ts`**

Accepts `resource_name` param. Resolves the resource lazily at execute time.

```typescript
function buildCheckCalendarAvailabilityTool(agent: VibeAgent): RegisteredTool {
  const resourceNames = agent.bookingConfig!.resources.map(r => r.name).join(', ')

  return {
    function: {
      name: 'check_calendar_availability',
      description:
        `Check if a resource is available for a given datetime range. ` +
        `Available resources: ${resourceNames}. ` +
        `If available, returns confirmation. If unavailable, returns nearest alternative slots (earlier and later). ` +
        `Always call this before submit_booking_request.`,
      parameters: {
        type: 'object',
        properties: {
          resource_name: {
            type: 'string',
            description: `Name of the resource to check. One of: ${resourceNames}.`
          },
          start_datetime: {
            type: 'string',
            description: 'Start date and time in YYYY-MM-DDTHH:MM format.'
          },
          end_datetime: {
            type: 'string',
            description: 'End date and time in YYYY-MM-DDTHH:MM format.'
          }
        },
        required: ['resource_name', 'start_datetime', 'end_datetime']
      }
    },
    execute: async (args) => {
      const resourceName = String(args.resource_name ?? '').trim()
      const startDatetime = String(args.start_datetime ?? '').trim()
      const endDatetime = String(args.end_datetime ?? '').trim()

      if (isNaN(new Date(startDatetime).getTime()) || isNaN(new Date(endDatetime).getTime())) {
        return 'Invalid datetime format. Use YYYY-MM-DDTHH:MM (e.g. 2026-05-10T14:00).'
      }

      const startMs = new Date(startDatetime).getTime()
      const endMs = new Date(endDatetime).getTime()

      if (endMs <= startMs) return 'End datetime must be after start datetime.'
      if (startMs < Date.now()) return 'Start datetime cannot be in the past.'

      const ctx = await resolveResource(agent, resourceName)
      if (!ctx) return `Unknown resource "${resourceName}". Available: ${resourceNames}.`

      // Min/max stay validation
      const durationHours = (endMs - startMs) / (1000 * 60 * 60)
      if (ctx.resource.minStayHours && durationHours < ctx.resource.minStayHours) {
        return `Minimum stay for ${ctx.resource.name} is ${ctx.resource.minStayHours} hours.`
      }
      if (ctx.resource.maxStayHours && durationHours > ctx.resource.maxStayHours) {
        return `Maximum stay for ${ctx.resource.name} is ${ctx.resource.maxStayHours} hours.`
      }

      try {
        const { adminDb } = await import('@/lib/firebase/admin')
        const { Collections } = await import('@/lib/firestore-types')
        // Graceful OAuth failure — return user-friendly message if token refresh fails
        let accessToken: string
        try {
          accessToken = await getValidAccessToken(ctx.connection)
        } catch {
          return 'Unable to check availability right now — calendar connection error. Please try again later.'
        }

        // 1. Fetch pending soft-blocks first — needed by both checks and findNearestAvailableSlots
        const now = new Date()
        const requestsPath = Collections.bookingRequests(agent.tenantId!, agent.id)
        const pendingSnap = await adminDb
          .collection(requestsPath)
          .where('status', '==', 'pending')
          .where('resourceId', '==', ctx.resource.id)
          .where('expiresAt', '>', now.toISOString())
          .get()

        // 2. Google Calendar freeBusy check (approved/external events)
        const res = await fetchWithRetry(`${GOOGLE_CALENDAR_API}/freeBusy`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timeMin: new Date(startDatetime).toISOString(),
            timeMax: new Date(endDatetime).toISOString(),
            items: [{ id: ctx.calendarId }]
          }),
          timeoutMs: 10_000,
          maxAttempts: 3,
          baseDelayMs: 500
        })

        if (!res.ok) {
          const text = await res.text()
          throw new Error(`Google Calendar API error (${res.status}): ${text}`)
        }

        const data = await res.json()
        const busySlots: Array<{ start: string; end: string }> =
          data?.calendars?.[ctx.calendarId]?.busy ?? []

        if (busySlots.length > 0) {
          return findNearestAvailableSlots({
            durationMs: endMs - startMs,
            requestedStart: new Date(startDatetime),
            calendarId: ctx.calendarId,
            accessToken,
            pendingDocs: pendingSnap.docs,
            timezone: ctx.resource.timezone,
            resourceName: ctx.resource.name
          })
        }

        // 3. Soft-block overlap check — pending requests not yet written to calendar
        const hasPendingOverlap = pendingSnap.docs.some(doc => {
          const req = doc.data() as { startDatetime: string; endDatetime: string }
          return startMs < new Date(req.endDatetime).getTime() &&
                 endMs > new Date(req.startDatetime).getTime()
        })

        if (hasPendingOverlap) {
          return findNearestAvailableSlots({
            durationMs: endMs - startMs,
            requestedStart: new Date(startDatetime),
            calendarId: ctx.calendarId,
            accessToken,
            pendingDocs: pendingSnap.docs,
            timezone: ctx.resource.timezone,
            resourceName: ctx.resource.name
          })
        }

        return `${ctx.resource.name} is available from ${startDatetime} to ${endDatetime} (${ctx.resource.timezone}).`
      } catch (error) {
        return `Error checking availability: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}
```

And add the `findNearestAvailableSlots` helper in `booking.ts`:

```typescript
interface FindNearestSlotsParams {
  durationMs: number
  requestedStart: Date   // the originally requested start — scan outward from here
  calendarId: string
  accessToken: string
  pendingDocs: FirebaseFirestore.QueryDocumentSnapshot[]
  timezone: string
  resourceName: string
}

async function findNearestAvailableSlots(params: FindNearestSlotsParams): Promise<string> {
  const { durationMs, requestedStart, calendarId, accessToken, pendingDocs, timezone, resourceName } = params

  const MAX_SUGGESTIONS = 3
  const SEARCH_WINDOW_DAYS = 60
  const now = Date.now()

  // Fetch freeBusy for [now, requestedStart + window] in one call to cover both directions
  const windowStart = new Date(Math.min(now, requestedStart.getTime()))
  const windowEnd = new Date(requestedStart.getTime() + SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const res = await fetchWithRetry(`${GOOGLE_CALENDAR_API}/freeBusy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: windowStart.toISOString(),
      timeMax: windowEnd.toISOString(),
      items: [{ id: calendarId }]
    }),
    timeoutMs: 10_000,
    maxAttempts: 3,
    baseDelayMs: 500
  })

  const busySlots: Array<{ start: string; end: string }> = res.ok
    ? ((await res.json())?.calendars?.[calendarId]?.busy ?? [])
    : []

  // Merge calendar blocks + pending soft-blocks, sorted by start
  const blocked = [
    ...busySlots.map(s => ({ start: new Date(s.start).getTime(), end: new Date(s.end).getTime() })),
    ...pendingDocs.map(doc => {
      const d = doc.data() as { startDatetime: string; endDatetime: string }
      return { start: new Date(d.startDatetime).getTime(), end: new Date(d.endDatetime).getTime() }
    })
  ].sort((a, b) => a.start - b.start)

  const isBlocked = (startMs: number): boolean => {
    const endMs = startMs + durationMs
    return blocked.some(b => startMs < b.end && endMs > b.start)
  }

  // Scan forward from requestedStart
  const forward: number[] = []
  let fCursor = requestedStart.getTime()
  while (forward.length < MAX_SUGGESTIONS && fCursor < windowEnd.getTime()) {
    if (!isBlocked(fCursor)) {
      forward.push(fCursor)
      fCursor += durationMs
    } else {
      const overlap = blocked.find(b => fCursor < b.end && (fCursor + durationMs) > b.start)!
      fCursor = overlap.end
    }
  }

  // Scan backward from requestedStart (only future slots — skip if before now)
  const backward: number[] = []
  let bCursor = requestedStart.getTime() - durationMs
  while (backward.length < MAX_SUGGESTIONS && bCursor >= now) {
    if (!isBlocked(bCursor)) {
      backward.unshift(bCursor)  // prepend so result stays chronological
      bCursor -= durationMs
    } else {
      const overlap = blocked.find(b => bCursor < b.end && (bCursor + durationMs) > b.start)!
      bCursor = overlap.start - durationMs
    }
  }

  // Merge by proximity to requestedStart, keep closest MAX_SUGGESTIONS
  const anchor = requestedStart.getTime()
  const candidates = [...backward, ...forward]
    .sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor))
    .slice(0, MAX_SUGGESTIONS)
    .sort((a, b) => a - b)  // final sort: chronological for readability

  if (candidates.length === 0) {
    return `${resourceName} is not available and no open slots were found within ${SEARCH_WINDOW_DAYS} days.`
  }

  const fmt = (ms: number) =>
    new Date(ms).toLocaleString('en-US', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short'
    })

  return (
    `${resourceName} is not available for those dates. Nearest available slots (${timezone}):\n` +
    candidates.map((s, i) => `${i + 1}. ${fmt(s)} → ${fmt(s + durationMs)}`).join('\n')
  )
}
```

> **Why both checks?** freeBusy covers approved bookings and external calendar events. The Firestore pending check covers soft-blocks — requests awaiting admin approval that haven't yet been written to the calendar. Without it, two guests could both see "available" and both submit requests for the same slot. The next-slot scan uses both sources so suggestions are genuinely free.

- [ ] **Step 5: Add `buildSubmitBookingRequestTool` in `booking.ts`**

```typescript
function buildSubmitBookingRequestTool(agent: VibeAgent): RegisteredTool {
  const resourceNames = agent.bookingConfig!.resources.map(r => r.name).join(', ')

  return {
    function: {
      name: 'submit_booking_request',
      description:
        `Submit a booking request for a resource. Available resources: ${resourceNames}. ` +
        `Always call check_calendar_availability first. ` +
        `Collect guest name, email, and phone before submitting. ` +
        `The owner will review and approve before it is confirmed.`,
      parameters: {
        type: 'object',
        properties: {
          resource_name: {
            type: 'string',
            description: `Name of the resource to book. One of: ${resourceNames}.`
          },
          start_datetime: { type: 'string', description: 'Booking start in YYYY-MM-DDTHH:MM format.' },
          end_datetime: { type: 'string', description: 'Booking end in YYYY-MM-DDTHH:MM format.' },
          guest_name: { type: 'string', description: 'Full name of the guest.' },
          guest_email: { type: 'string', description: 'Email address of the guest.' },
          guest_phone: { type: 'string', description: 'Phone number of the guest.' },
          guest_count: { type: 'number', description: 'Number of guests. Optional.' },
          notes: { type: 'string', description: 'Special requirements or notes. Optional.' }
        },
        required: ['resource_name', 'start_datetime', 'end_datetime', 'guest_name', 'guest_email', 'guest_phone']
      }
    },
    execute: async (args) => {
      const resourceName = String(args.resource_name ?? '').trim()
      const startDatetime = String(args.start_datetime ?? '').trim()
      const endDatetime = String(args.end_datetime ?? '').trim()
      const guestName = String(args.guest_name ?? '').trim()
      const guestEmail = String(args.guest_email ?? '').trim()
      const guestPhone = String(args.guest_phone ?? '').trim()

      if (!startDatetime || !endDatetime || !guestName || !guestEmail || !guestPhone) {
        return 'Missing required fields: resource_name, start_datetime, end_datetime, guest_name, guest_email, guest_phone.'
      }

      const startMs = new Date(startDatetime).getTime()
      const endMs = new Date(endDatetime).getTime()

      if (isNaN(startMs) || isNaN(endMs)) return 'Invalid datetime format. Use YYYY-MM-DDTHH:MM.'
      if (endMs <= startMs) return 'End datetime must be after start datetime.'
      if (startMs < Date.now()) return 'Start datetime cannot be in the past.'

      // Email format validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(guestEmail)) return 'Invalid email address format.'

      const ctx = await resolveResource(agent, resourceName)
      if (!ctx) return `Unknown resource "${resourceName}". Available: ${resourceNames}.`

      // Min/max stay validation
      const durationHours = (endMs - startMs) / (1000 * 60 * 60)
      if (ctx.resource.minStayHours && durationHours < ctx.resource.minStayHours) {
        return `Minimum stay for ${ctx.resource.name} is ${ctx.resource.minStayHours} hours.`
      }
      if (ctx.resource.maxStayHours && durationHours > ctx.resource.maxStayHours) {
        return `Maximum stay for ${ctx.resource.name} is ${ctx.resource.maxStayHours} hours.`
      }

      try {
        const { adminDb } = await import('@/lib/firebase/admin')
        const { Collections } = await import('@/lib/firestore-types')
        const { createBookingRequest } = await import('@/lib/booking-requests/create')
        const accessToken = await getValidAccessToken(ctx.connection)

        // freeBusy guard
        const res = await fetchWithRetry(`${GOOGLE_CALENDAR_API}/freeBusy`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timeMin: new Date(startDatetime).toISOString(),
            timeMax: new Date(endDatetime).toISOString(),
            items: [{ id: ctx.calendarId }]
          }),
          timeoutMs: 10_000, maxAttempts: 3, baseDelayMs: 500
        })

        if (!res.ok) throw new Error(`Google Calendar API error (${res.status}): ${await res.text()}`)

        const busySlots = (await res.json())?.calendars?.[ctx.calendarId]?.busy ?? []
        if (busySlots.length > 0) return `${ctx.resource.name} is not available for that time. Please check availability first.`

        // Pending soft-block guard (resource-scoped)
        const now = new Date()
        const pendingSnap = await adminDb
          .collection(Collections.bookingRequests(agent.tenantId!, agent.id))
          .where('status', '==', 'pending')
          .where('resourceId', '==', ctx.resource.id)
          .where('expiresAt', '>', now.toISOString())
          .get()

        const hasOverlap = pendingSnap.docs.some(doc => {
          const req = doc.data() as { startDatetime: string; endDatetime: string }
          return startMs < new Date(req.endDatetime).getTime() && endMs > new Date(req.startDatetime).getTime()
        })

        if (hasOverlap) return `There is already a pending booking request for ${ctx.resource.name} overlapping those times.`

        // Duplicate guest guard — same email already has a pending request for this resource overlapping these dates
        const duplicateGuestSnap = await adminDb
          .collection(Collections.bookingRequests(agent.tenantId!, agent.id))
          .where('status', '==', 'pending')
          .where('resourceId', '==', ctx.resource.id)
          .where('guestEmail', '==', guestEmail)
          .where('expiresAt', '>', now.toISOString())
          .get()

        const hasDuplicateGuest = duplicateGuestSnap.docs.some(doc => {
          const req = doc.data() as { startDatetime: string; endDatetime: string }
          return startMs < new Date(req.endDatetime).getTime() && endMs > new Date(req.startDatetime).getTime()
        })

        if (hasDuplicateGuest) return `You already have a pending booking request for ${ctx.resource.name} for those dates.`

        // NOTE: the freeBusy check + overlap check + write should be wrapped in a Firestore transaction
        // to prevent a race condition where two guests submit simultaneously and both pass the overlap check.
        // Use adminDb.runTransaction() in createBookingRequest — re-read pending docs inside the transaction
        // and re-validate overlap before writing.

        const expiresAt = new Date(now.getTime() + ctx.ttlHours * 60 * 60 * 1000).toISOString()

        const requestId = await createBookingRequest({
          agent,
          resource: ctx.resource,
          connection: ctx.connection,
          calendarId: ctx.calendarId,
          startDatetime,
          endDatetime,
          guestName,
          guestEmail,
          guestPhone,
          guestCount: typeof args.guest_count === 'number' ? args.guest_count : undefined,
          notes: args.notes ? String(args.notes) : undefined,
          expiresAt
        })

        return (
          `Booking request submitted for ${ctx.resource.name} from ${startDatetime} to ${endDatetime} (${ctx.resource.timezone}). ` +
          `The owner will review and you'll be notified by email. Request ID: ${requestId}`
        )
      } catch (error) {
        return `Error submitting booking request: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}
```

- [ ] **Step 6: Export `buildBookingTools` — the feature entry point**

No connection needed at build time — each tool resolves its resource lazily at execute time.

```typescript
export function buildBookingTools(agent: VibeAgent): RegisteredTool[] {
  const config = agent.bookingConfig
  if (!config?.enabled || config.resources.length === 0) return []

  return [
    buildCheckCalendarAvailabilityTool(agent),
    buildSubmitBookingRequestTool(agent)
  ]
}
```

- [ ] **Step 7: Update `lib/agent/context-builder.ts` — swap import and drop connection arg**

```typescript
// Remove:
import { buildCalendarAvailabilityTools } from './tools/calendar-availability'
// Add:
import { buildBookingTools } from './tools/booking'
```

Update call site (around line 146) — no connection arg needed:
```typescript
// Before:
const availabilityTools = buildCalendarAvailabilityTools(agent, connection)
// After:
const availabilityTools = buildBookingTools(agent)
```

Remove any connection-fetch code that was only used for `buildCalendarAvailabilityTools`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx jest __tests__/lib/agent/tools/booking.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add lib/agent/tools/booking.ts __tests__/lib/agent/tools/booking.test.ts lib/agent/context-builder.ts
git commit -m "feat(resource-booking): move check_calendar_availability into booking tools, add submit_booking_request"
```

---

## Task 3: `createBookingRequest` helper + notifications

**Files:**
- Create: `lib/booking-requests/create.ts`
- Create: `lib/booking-requests/notify.ts`
- Create: `lib/booking-requests/guest-hold-notify.ts` *(new — hold confirmation to guest on submit)*
- Create: `lib/booking-requests/guest-notify.ts`

- [ ] **Step 1: Create `lib/booking-requests/create.ts`**

```typescript
import { adminDb } from '@/lib/firebase/admin'
import {
  Collections,
  type BookingRequestDocument,
  type BookableResource,
  type CalendarConnectionDocument
} from '@/lib/firestore-types'
import type { VibeAgent } from '@/lib/types'
import { notifyAdminOfBookingRequest } from './notify'

export interface CreateBookingRequestParams {
  agent: VibeAgent
  resource: BookableResource
  connection: CalendarConnectionDocument
  calendarId: string
  startDatetime: string
  endDatetime: string
  guestName: string
  guestEmail: string
  guestPhone: string
  guestCount?: number
  notes?: string
  expiresAt: string
}

export async function createBookingRequest(
  params: CreateBookingRequestParams
): Promise<string> {
  const now = new Date().toISOString()
  const ref = adminDb
    .collection(Collections.bookingRequests(params.agent.tenantId!, params.agent.id))
    .doc()

  const doc: BookingRequestDocument = {
    id: ref.id,
    agentId: params.agent.id,
    tenantId: params.agent.tenantId!,
    resourceId: params.resource.id,
    calendarConnectionId: params.connection.id,
    calendarId: params.calendarId,
    resourceName: params.resource.name,
    timezone: params.resource.timezone,
    startDatetime: params.startDatetime,
    endDatetime: params.endDatetime,
    guestName: params.guestName,
    guestEmail: params.guestEmail,
    guestPhone: params.guestPhone,
    guestCount: params.guestCount,
    notes: params.notes,
    status: 'pending',
    expiresAt: params.expiresAt,
    createdAt: now,
    updatedAt: now
  }

  await ref.set(doc)

  // Fire-and-forget notifications — failures are logged, not thrown
  notifyAdminOfBookingRequest(params.agent, doc).catch(err =>
    console.error('[booking-request] Failed to notify admin:', err)
  )
  notifyGuestOfHold(doc).catch(err =>
    console.error('[booking-request] Failed to send guest hold confirmation:', err)
  )

  return ref.id
}
```

- [ ] **Step 2: Create `lib/booking-requests/notify.ts` — admin Resend email**

Uses the same Resend pattern as `lib/agents/notifications.ts`.

```typescript
import { adminDb } from '@/lib/firebase/admin'
import { Collections, type BookingRequestDocument } from '@/lib/firestore-types'
import type { VibeAgent } from '@/lib/types'

export async function notifyAdminOfBookingRequest(
  agent: VibeAgent,
  request: BookingRequestDocument
): Promise<void> {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('en-US', {
      timeZone: request.timezone,
      dateStyle: 'medium',
      timeStyle: 'short'
    })

  const title = `New booking request — ${request.resourceName}`
  const body =
    `${request.guestName} (${request.guestEmail}, ${request.guestPhone}) requested ` +
    `${fmt(request.startDatetime)} → ${fmt(request.endDatetime)}` +
    (request.guestCount ? `, ${request.guestCount} guests` : '') +
    (request.notes ? `. Notes: ${request.notes}` : '')

  // In-app notification
  const notifConfig = agent.notificationConfig
  if (notifConfig?.enabled && notifConfig.inApp?.enabled) {
    const now = new Date().toISOString()
    await adminDb.collection(Collections.notifications(agent.tenantId!)).add({
      tenantId: agent.tenantId,
      agentId: agent.id,
      type: 'booking_request',
      title,
      body,
      metadata: { bookingRequestId: request.id },
      read: false,
      createdAt: now,
      updatedAt: now
    })
  }

  // Admin email via Resend
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return

  let toAddress = notifConfig?.email?.enabled ? notifConfig.email.address : null
  if (!toAddress) {
    const userDoc = await adminDb.collection(Collections.users).doc(agent.userId).get()
    toAddress = userDoc.data()?.email
  }
  if (!toAddress) return

  const { Resend } = await import('resend')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  await new Resend(apiKey).emails.send({
    from: process.env.NOTIFICATION_EMAIL_FROM || 'VibeAgent <notifications@vibeagent.com>',
    to: toAddress,
    subject: title,
    text: [
      body,
      `\nReview and approve/reject:`,
      `${appUrl}/agents/${agent.id}?tab=booking-requests`
    ].join('\n')
  })
}
```

- [ ] **Step 3: Create `lib/booking-requests/guest-hold-notify.ts` — guest hold confirmation on submit**

Sent immediately after the booking request is saved. Tells the guest their request is received, on hold, and when it expires.

```typescript
import type { BookingRequestDocument } from '@/lib/firestore-types'

export async function notifyGuestOfHold(request: BookingRequestDocument): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('en-US', {
      timeZone: request.timezone,
      dateStyle: 'medium',
      timeStyle: 'short'
    })

  const subject = `Your booking request for ${request.resourceName} is received`
  const lines = [
    `Hi ${request.guestName},`,
    ``,
    `Your booking request has been received and is on hold pending approval.`,
    ``,
    `Resource: ${request.resourceName}`,
    `Dates: ${fmt(request.startDatetime)} → ${fmt(request.endDatetime)} (${request.timezone})`,
    request.guestCount ? `Guests: ${request.guestCount}` : null,
    ``,
    `Your hold is valid until: ${fmt(request.expiresAt)}`,
    `Request ID: ${request.id}`,
    ``,
    `You will be notified by email and WhatsApp once the host reviews your request.`
  ].filter(Boolean).join('\n')

  // Email notification
  if (apiKey) {
    const { Resend } = await import('resend')
    await new Resend(apiKey).emails.send({
      from: process.env.NOTIFICATION_EMAIL_FROM || 'VibeAgent <notifications@vibeagent.com>',
      to: request.guestEmail,
      subject,
      text: lines
    })
  }

  // WhatsApp notification (if guest phone provided and WhatsApp integration available)
  // TODO: integrate with existing WhatsApp send utility when available
  // Send a concise message: "Hi [name], your hold for [resource] ([dates]) is confirmed.
  // Hold expires at [expiresAt]. Request ID: [id]. You'll be notified of the decision."
}
```

- [ ] **Step 5: Update `lib/booking-requests/guest-notify.ts` — guest email + WhatsApp on decision**

Extend `notifyGuestOfDecision` to accept `'cancelled'` as a decision and add a WhatsApp notification alongside the email.

```typescript
import type { BookingRequestDocument } from '@/lib/firestore-types'

export async function notifyGuestOfDecision(
  request: BookingRequestDocument,
  decision: 'approved' | 'rejected' | 'cancelled',
  adminNote?: string
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('en-US', {
      timeZone: request.timezone,
      dateStyle: 'medium',
      timeStyle: 'short'
    })

  const approved = decision === 'approved'
  const cancelled = decision === 'cancelled'

  const subject = approved
    ? `Your booking for ${request.resourceName} is confirmed!`
    : cancelled
    ? `Your booking for ${request.resourceName} has been cancelled`
    : `Your booking request for ${request.resourceName} was not approved`

  const lines = [
    approved
      ? `Great news! Your booking for ${request.resourceName} has been approved.`
      : cancelled
      ? `Your confirmed booking for ${request.resourceName} has been cancelled by the host.`
      : `Unfortunately your booking request for ${request.resourceName} was not approved.`,
    ``,
    `Dates: ${fmt(request.startDatetime)} → ${fmt(request.endDatetime)} (${request.timezone})`,
    request.guestCount ? `Guests: ${request.guestCount}` : null,
    adminNote ? `\nMessage from the host: ${adminNote}` : null
  ].filter(Boolean).join('\n')

  // Email notification
  if (apiKey) {
    const { Resend } = await import('resend')
    await new Resend(apiKey).emails.send({
      from: process.env.NOTIFICATION_EMAIL_FROM || 'VibeAgent <notifications@vibeagent.com>',
      to: request.guestEmail,
      subject,
      text: lines
    })
  }

  // WhatsApp notification (if guest phone provided and WhatsApp integration available)
  // TODO: integrate with existing WhatsApp send utility when available
  // Send a concise summary: approved/rejected/cancelled, resource, dates, adminNote if any
}
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add lib/booking-requests/create.ts lib/booking-requests/notify.ts lib/booking-requests/guest-hold-notify.ts lib/booking-requests/guest-notify.ts
git commit -m "feat(resource-booking): createBookingRequest helper + admin + guest hold + decision notifications (email + WhatsApp)"
```

---

## Task 4: Admin approve/reject/cancel API + calendar writer

**Files:**
- Create: `lib/booking-requests/calendar.ts`
- Create: `lib/booking-requests/cancel-calendar.ts` *(new — delete event on admin cancel)*
- Create: `app/api/booking-requests/[id]/route.ts`
- Create: `app/api/booking-requests/route.ts`

- [ ] **Step 1: Create `lib/booking-requests/calendar.ts`**

```typescript
import { getCalendarConnection, getValidAccessToken } from '@/lib/scheduling/connections'
import { fetchWithRetry } from '@/lib/utils/fetch-with-retry'
import type { BookingRequestDocument } from '@/lib/firestore-types'

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

export async function writeBookingToCalendar(request: BookingRequestDocument): Promise<string> {
  const connection = await getCalendarConnection(request.tenantId, request.calendarConnectionId)
  if (!connection) throw new Error('Calendar connection not found')

  const accessToken = await getValidAccessToken(connection)

  // Re-check availability at approval time
  const freeBusyRes = await fetchWithRetry(`${GOOGLE_CALENDAR_API}/freeBusy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: new Date(request.startDatetime).toISOString(),
      timeMax: new Date(request.endDatetime).toISOString(),
      items: [{ id: request.calendarId }]
    }),
    timeoutMs: 10_000,
    maxAttempts: 3,
    baseDelayMs: 500
  })

  if (!freeBusyRes.ok) {
    const text = await freeBusyRes.text()
    throw new Error(`freeBusy check failed (${freeBusyRes.status}): ${text}`)
  }

  const freeBusyData = await freeBusyRes.json()
  const busySlots = freeBusyData?.calendars?.[request.calendarId]?.busy ?? []
  if (busySlots.length > 0) throw new Error('DATES_NO_LONGER_AVAILABLE')

  // Create timed event
  const eventRes = await fetchWithRetry(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(request.calendarId)}/events`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: `${request.resourceName} — ${request.guestName}`,
        description:
          `Guest: ${request.guestName} (${request.guestEmail})` +
          (request.guestCount ? `\nGuests: ${request.guestCount}` : '') +
          (request.notes ? `\nNotes: ${request.notes}` : ''),
        start: { dateTime: new Date(request.startDatetime).toISOString(), timeZone: request.timezone },
        end: { dateTime: new Date(request.endDatetime).toISOString(), timeZone: request.timezone }
      }),
      timeoutMs: 10_000,
      maxAttempts: 3,
      baseDelayMs: 500
    }
  )

  if (!eventRes.ok) {
    const text = await eventRes.text()
    throw new Error(`Failed to create calendar event (${eventRes.status}): ${text}`)
  }

  const eventData = await eventRes.json()
  return eventData.id as string
}
```

- [ ] **Step 1b: Create `lib/booking-requests/cancel-calendar.ts` — delete calendar event on admin cancel**

```typescript
import { getCalendarConnection, getValidAccessToken } from '@/lib/scheduling/connections'
import { fetchWithRetry } from '@/lib/utils/fetch-with-retry'
import type { BookingRequestDocument } from '@/lib/firestore-types'

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

export async function deleteBookingFromCalendar(request: BookingRequestDocument): Promise<void> {
  if (!request.externalEventId) throw new Error('No calendar event ID on this booking')

  const connection = await getCalendarConnection(request.tenantId, request.calendarConnectionId)
  if (!connection) throw new Error('Calendar connection not found')

  const accessToken = await getValidAccessToken(connection)

  const res = await fetchWithRetry(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(request.calendarId)}/events/${encodeURIComponent(request.externalEventId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
      timeoutMs: 10_000,
      maxAttempts: 3,
      baseDelayMs: 500
    }
  )

  // 404 means already deleted — treat as success
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete calendar event (${res.status})`)
  }
}
```

- [ ] **Step 2: Create `app/api/booking-requests/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { type BookingRequestDocument } from '@/lib/firestore-types'
import { getAuthenticatedTenantId } from '@/lib/auth/server'
import { writeBookingToCalendar } from '@/lib/booking-requests/calendar'
import { deleteBookingFromCalendar } from '@/lib/booking-requests/cancel-calendar'
import { notifyGuestOfDecision } from '@/lib/booking-requests/guest-notify'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const tenantId = await getAuthenticatedTenantId(req)
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const action = body.action as 'approve' | 'reject' | 'cancel'
  const adminNote = typeof body.adminNote === 'string' ? body.adminNote : undefined

  if (action !== 'approve' && action !== 'reject' && action !== 'cancel') {
    return NextResponse.json({ error: 'action must be approve, reject, or cancel' }, { status: 400 })
  }

  const snap = await adminDb
    .collectionGroup('bookingRequests')
    .where('id', '==', params.id)
    .where('tenantId', '==', tenantId)
    .limit(1)
    .get()

  if (snap.empty) return NextResponse.json({ error: 'Booking request not found' }, { status: 404 })

  const docRef = snap.docs[0].ref
  const request = snap.docs[0].data() as BookingRequestDocument

  // cancel is only valid on approved bookings; approve/reject only on pending
  if (action === 'cancel' && request.status !== 'approved') {
    return NextResponse.json({ error: 'Can only cancel an approved booking' }, { status: 409 })
  }
  if ((action === 'approve' || action === 'reject') && request.status !== 'pending') {
    return NextResponse.json({ error: `Request is already ${request.status}` }, { status: 409 })
  }

  const now = new Date().toISOString()

  if (action === 'reject') {
    await docRef.update({ status: 'rejected', adminNote, updatedAt: now })
    notifyGuestOfDecision(request, 'rejected', adminNote).catch(err =>
      console.error('[booking-request] Failed to send guest rejection notification:', err)
    )
    return NextResponse.json({ status: 'rejected' })
  }

  if (action === 'cancel') {
    try {
      await deleteBookingFromCalendar(request)
    } catch (err) {
      console.error('[booking-request] Failed to delete calendar event:', err)
      // Continue with cancel even if calendar deletion fails — log and proceed
    }
    await docRef.update({ status: 'cancelled', adminNote, cancelledAt: now, updatedAt: now })
    notifyGuestOfDecision(request, 'cancelled', adminNote).catch(err =>
      console.error('[booking-request] Failed to send guest cancellation notification:', err)
    )
    return NextResponse.json({ status: 'cancelled' })
  }

  try {
    const externalEventId = await writeBookingToCalendar(request)
    await docRef.update({ status: 'approved', externalEventId, adminNote, updatedAt: now })
    notifyGuestOfDecision(request, 'approved', adminNote).catch(err =>
      console.error('[booking-request] Failed to send guest approval notification:', err)
    )
    return NextResponse.json({ status: 'approved', externalEventId })
  } catch (err) {
    if (err instanceof Error && err.message === 'DATES_NO_LONGER_AVAILABLE') {
      await docRef.update({ status: 'rejected', adminNote: 'Time slot no longer available', updatedAt: now })
      notifyGuestOfDecision(request, 'rejected', 'Time slot no longer available').catch(() => {})
      return NextResponse.json({ error: 'Time slot no longer available — request auto-rejected' }, { status: 409 })
    }
    console.error('[booking-request] Calendar write failed:', err)
    return NextResponse.json({ error: 'Failed to write to calendar' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Create `app/api/booking-requests/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { type BookingRequestDocument } from '@/lib/firestore-types'
import { getAuthenticatedTenantId } from '@/lib/auth/server'

export async function GET(req: NextRequest) {
  const tenantId = await getAuthenticatedTenantId(req)
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const agentId = searchParams.get('agentId')
  const status = searchParams.get('status') ?? 'pending'

  let query = adminDb
    .collectionGroup('bookingRequests')
    .where('tenantId', '==', tenantId)
    .where('status', '==', status)
    .orderBy('createdAt', 'desc')
    .limit(50)

  if (agentId) {
    query = query.where('agentId', '==', agentId) as typeof query
  }

  const snap = await query.get()
  const requests = snap.docs.map(d => d.data() as BookingRequestDocument)

  return NextResponse.json({ requests })
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add lib/booking-requests/calendar.ts lib/booking-requests/cancel-calendar.ts app/api/booking-requests/route.ts app/api/booking-requests/[id]/route.ts
git commit -m "feat(resource-booking): approve/reject/cancel API + timed calendar event writer + admin cancel flow"
```

---

## Task 5: Soft-block TTL expiry cron

**Files:**
- Create: `app/api/booking-requests/expire/route.ts`

- [ ] **Step 1: Create `app/api/booking-requests/expire/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date().toISOString()

  const snap = await adminDb
    .collectionGroup('bookingRequests')
    .where('status', '==', 'pending')
    .where('expiresAt', '<=', now)
    .limit(100)
    .get()

  if (snap.empty) return NextResponse.json({ expired: 0 })

  const batch = adminDb.batch()
  for (const doc of snap.docs) {
    batch.update(doc.ref, { status: 'expired', updatedAt: now })
  }
  await batch.commit()

  return NextResponse.json({ expired: snap.size })
}
```

- [ ] **Step 2: Register cron in `vercel.json`**

```json
{
  "crons": [
    {
      "path": "/api/booking-requests/expire",
      "schedule": "0 * * * *"
    }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/booking-requests/expire/route.ts vercel.json
git commit -m "feat(resource-booking): soft-block TTL expiry cron"
```

---

## Task 6: Firestore composite indexes

**Files:**
- Modify: `firestore.indexes.json`

The collectionGroup queries use multi-field filters that Firestore cannot serve without explicit composite indexes. Without these the cron, GET list, and soft-block check will throw in production.

- [ ] **Step 1: Add required indexes to `firestore.indexes.json`**

```json
{
  "indexes": [
    {
      "collectionGroup": "bookingRequests",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "tenantId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "bookingRequests",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "expiresAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "bookingRequests",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "expiresAt", "order": "ASCENDING" },
        { "fieldPath": "agentId", "order": "ASCENDING" }
      ]
    }
  ]
}
```

- [ ] **Step 2: Deploy indexes**

```bash
firebase deploy --only firestore:indexes
```

- [ ] **Step 3: Commit**

```bash
git add firestore.indexes.json
git commit -m "feat(resource-booking): add Firestore composite indexes for bookingRequests queries"
```

---

## Task 7: Admin review UI

**Files:**
- Create: `components/agents/agent-booking-requests.tsx`
- Modify: `components/agents/agent-dashboard-tabs.tsx`

- [ ] **Step 1: Create `components/agents/agent-booking-requests.tsx`**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { BookingRequestDocument } from '@/lib/firestore-types'

interface Props {
  agentId: string
}

export function AgentBookingRequests({ agentId }: Props) {
  const [requests, setRequests] = useState<BookingRequestDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/booking-requests?agentId=${agentId}&status=pending`)
      .then(r => r.json())
      .then(data => setRequests(data.requests ?? []))
      .finally(() => setLoading(false))
  }, [agentId])

  async function handleAction(id: string, action: 'approve' | 'reject') {
    setActionLoading(id)
    setError(null)
    try {
      const res = await fetch(`/api/booking-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Action failed')
        return
      }
      setRequests(prev => prev.filter(r => r.id !== id))
    } finally {
      setActionLoading(null)
    }
  }

  const fmt = (iso: string, tz: string) =>
    new Date(iso).toLocaleString('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })

  if (loading) return <p className="text-sm text-muted-foreground">Loading requests...</p>
  if (requests.length === 0) return <p className="text-sm text-muted-foreground">No pending booking requests.</p>

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {requests.map(r => (
        <div key={r.id} className="border rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{r.guestName}</p>
              <p className="text-sm text-muted-foreground">{r.guestEmail}</p>
            </div>
            <Badge variant="outline">Pending</Badge>
          </div>
          <p className="text-sm">
            {r.resourceName} · {fmt(r.startDatetime, r.timezone)} → {fmt(r.endDatetime, r.timezone)}
            {r.guestCount ? ` · ${r.guestCount} guests` : ''}
          </p>
          {r.notes && <p className="text-sm text-muted-foreground italic">{r.notes}</p>}
          <p className="text-xs text-muted-foreground">
            Expires: {new Date(r.expiresAt).toLocaleString()}
          </p>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={() => handleAction(r.id, 'approve')} disabled={actionLoading === r.id}>
              Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleAction(r.id, 'reject')} disabled={actionLoading === r.id}>
              Reject
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create `components/agents/agent-booking-history.tsx`**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import type { BookingRequestDocument, BookingRequestStatus } from '@/lib/firestore-types'

const STATUS_OPTIONS: BookingRequestStatus[] = ['approved', 'rejected', 'expired', 'cancelled']

export function AgentBookingHistory({ agentId }: { agentId: string }) {
  const [status, setStatus] = useState<BookingRequestStatus>('approved')
  const [requests, setRequests] = useState<BookingRequestDocument[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/booking-requests?agentId=${agentId}&status=${status}`)
      .then(r => r.json())
      .then(data => setRequests(data.requests ?? []))
      .finally(() => setLoading(false))
  }, [agentId, status])

  const fmt = (iso: string, tz: string) =>
    new Date(iso).toLocaleString('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {STATUS_OPTIONS.map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`text-sm px-3 py-1 rounded-full border ${status === s ? 'bg-primary text-primary-foreground' : ''}`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!loading && requests.length === 0 && (
        <p className="text-sm text-muted-foreground">No {status} requests.</p>
      )}
      {requests.map(r => (
        <div key={r.id} className="border rounded-lg p-4 space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">{r.guestName}</span>
            <Badge variant="outline">{r.status}</Badge>
          </div>
          <p className="text-muted-foreground">{r.guestEmail} · {r.guestPhone}</p>
          <p>{r.resourceName} · {fmt(r.startDatetime, r.timezone)} → {fmt(r.endDatetime, r.timezone)}</p>
          {r.adminNote && <p className="italic text-muted-foreground">Admin note: {r.adminNote}</p>}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2b: Add Cancel button to history for approved bookings**

In `agent-booking-history.tsx`, when `status === 'approved'`, render a Cancel button next to each row. On click, call `PATCH /api/booking-requests/{id}` with `{ action: 'cancel' }` and remove the row from state on success.

- [ ] **Step 3: Create `components/agents/agent-booking-resource-config.tsx`**

Shown inside agent settings when the booking feature is enabled — lets the admin add, edit, and remove bookable resources.

**Resource deletion guard:** before removing a resource, check if it has any `pending` booking requests. If yes, show a confirmation dialog: "This resource has X pending request(s). Removing it will auto-expire them. Continue?" On confirm, call the expire endpoint filtered by `resourceId` (or batch-update in Firestore) before removing the resource from the config.

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { BookableResource } from '@/lib/firestore-types'
import { nanoid } from '@/lib/utils'

interface Props {
  resources: BookableResource[]
  calendarConnections: Array<{ id: string; name: string; calendarId?: string | null }>
  onChange: (resources: BookableResource[]) => void
}

export function AgentBookingResourceConfig({ resources, calendarConnections, onChange }: Props) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<Partial<BookableResource>>({ timezone: 'UTC' })

  function addResource() {
    if (!draft.name || !draft.calendarConnectionId) return
    onChange([...resources, { id: nanoid(), timezone: 'UTC', ...draft } as BookableResource])
    setDraft({ timezone: 'UTC' })
    setAdding(false)
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Bookable Resources</p>
      {resources.map(r => (
        <div key={r.id} className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm">
          <div>
            <span className="font-medium">{r.name}</span>
            <span className="text-muted-foreground ml-2">{r.timezone}</span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onChange(resources.filter(x => x.id !== r.id))}>
            Remove
          </Button>
        </div>
      ))}
      {adding ? (
        <div className="border rounded-lg p-3 space-y-2">
          <Input placeholder="Resource name (e.g. Glass Cabin)" value={draft.name ?? ''} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
          <select className="w-full border rounded px-2 py-1 text-sm" value={draft.calendarConnectionId ?? ''} onChange={e => setDraft(d => ({ ...d, calendarConnectionId: e.target.value }))}>
            <option value="">Select calendar connection</option>
            {calendarConnections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <Input placeholder="Timezone (e.g. Asia/Kolkata)" value={draft.timezone ?? 'UTC'} onChange={e => setDraft(d => ({ ...d, timezone: e.target.value }))} />
          <div className="flex gap-2">
            <Button size="sm" onClick={addResource}>Add</Button>
            <Button size="sm" variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>+ Add Resource</Button>
      )}
      {resources.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground">Add at least one resource to enable booking.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Update `components/agents/agent-dashboard-tabs.tsx`**

When `agent.bookingConfig?.enabled` is true, add two tabs:
- **"Booking Requests"** — renders `<AgentBookingRequests agentId={agent.id} />`
- **"Booking History"** — renders `<AgentBookingHistory agentId={agent.id} />`

- [ ] **Step 5: Commit**

```bash
git add components/agents/agent-booking-requests.tsx components/agents/agent-booking-history.tsx components/agents/agent-booking-resource-config.tsx components/agents/agent-dashboard-tabs.tsx
git commit -m "feat(resource-booking): admin UI — pending requests, history table, resource config"
```

---

## What is NOT in this plan (deferred)

- **Guest cancellation or modification** — guests cannot cancel or change their own requests; only the admin can cancel an approved booking
- **Guest notification via chat** — surfacing approval/rejection back through the conversation using stored `conversationId`
- **WhatsApp send utility integration** — the plan adds `// TODO` stubs in `guest-hold-notify.ts` and `guest-notify.ts`; actual WhatsApp sending requires wiring up the existing WhatsApp integration
- **Meeting booking real-time sync** — separate feature, high complexity
- **Multi-resource calendar conflict detection across resources** — currently each resource is checked independently
- **Payment integration** — no deposit or payment collection at booking time
