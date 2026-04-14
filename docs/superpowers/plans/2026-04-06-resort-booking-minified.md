# Resort Booking — Minified Plan

> **Scope:** Guest enquires → agent checks calendar → confirms or suggests slots → guest submits request → admin gets email → admin tracks in a simple table and manually adds to Google Calendar.
> No approval flow. No TTL. No cron. No WhatsApp. No guest notifications after submit.

---

## Feature: `simple-booking`

`simple-booking` is a single agent feature that exposes **two tools** to the agent. It is not split into sub-features — calendar availability checking is just a tool within the same feature, not a separate capability.

```
Feature: simple-booking
├── Tool: check_calendar_availability   ← internal tool, checks freeBusy + suggests slots
└── Tool: submit_enquiry                ← saves to Firestore, emails admin
```

`check_calendar_availability` is a prerequisite step the agent calls before `submit_enquiry`. Both tools are registered together by `buildSimpleBookingTools(agent)` and enabled/disabled as one unit via `bookingConfig.enabled`.

---

## What this builds

| Who | What |
|-----|------|
| Guest | Ask the agent about availability, get confirmed or suggested slots, submit a booking enquiry |
| Agent (tool) | `check_calendar_availability` — checks Google Calendar freeBusy, returns available or nearest alternatives |
| Agent (tool) | `submit_enquiry` — saves request to Firestore, emails the admin |
| Admin | Receives email with enquiry details |
| Admin | Views all enquiries in a simple read-only table |
| Admin | Opens email, clicks the `.ics` attachment — booking is added to their calendar instantly |

---

## Architecture

- **No approval API.** Admin acts directly from the email — clicks the `.ics` attachment to add to Google Calendar, Apple Calendar, or Outlook in one tap.
- **No external ICS library.** Generated as plain text in `ics.ts` — iCalendar is a simple text format.
- **No TTL / expiry cron.** Enquiries stay as records indefinitely.
- **No guest notifications after submit.** Agent tells the guest "request sent, admin will contact you."
- Reuses: `CalendarConnectionDocument`, `getValidAccessToken`, `getCalendarConnection`, Resend.

---

## Firestore type

```typescript
// /tenants/{tenantId}/agents/{agentId}/bookingEnquiries/{enquiryId}
export interface BookingEnquiryDocument {
  id: string
  agentId: string
  tenantId: string
  resourceName: string
  calendarId: string       // Google Calendar ID for this resource — flows from BookableResource
  calendarName: string     // Human-readable calendar name — shown in admin email so admin knows which calendar to add to
  timezone: string

  startDatetime: string   // ISO wall-clock, e.g. "2026-05-10T14:00:00"
  endDatetime: string

  guestName: string
  guestEmail: string
  guestPhone: string
  guestCount?: number
  notes?: string

  createdAt: string
}
```

Add to `Collections`:
```typescript
bookingEnquiries: (tenantId: string, agentId: string) =>
  `tenants/${tenantId}/agents/${agentId}/bookingEnquiries` as const,
```

---

## Agent config

Keep existing `bookingConfig` schema (resources, timezone). Remove TTL, min/max stay — not needed here.

```typescript
// lib/agents/schema.ts
export const bookableResourceSchema = z.object({
  id: z.string(),
  name: z.string().max(100),
  calendarConnectionId: z.string(),
  calendarId: z.string(),           // Google Calendar ID — required, set via calendar picker
  calendarName: z.string(),         // Human-readable name — stored alongside calendarId for email display
  timezone: z.string().default('UTC')
})

export const bookingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  resources: z.array(bookableResourceSchema).default([])
})
```

Corresponding TypeScript interfaces in `lib/firestore-types.ts`:

```typescript
export interface BookableResource {
  id: string
  name: string
  calendarConnectionId: string
  calendarId: string
  calendarName: string
  timezone: string
}

export interface AgentBookingConfig {
  enabled: boolean
  resources: BookableResource[]
}
```

`VibeAgent` in `lib/types.ts`:
```typescript
bookingConfig?: AgentBookingConfig | null
```

---

## Coexistence with existing calendar-availability feature

The project already has a `check_calendar_availability` tool in `lib/agent/tools/calendar-availability.ts` (used by the calendar availability / scheduling feature). **Do not touch or delete that file.**

`simple-booking` registers its own `check_calendar_availability` tool scoped to booking resources. To avoid two tools with the same name being registered simultaneously, the context-builder must treat them as **mutually exclusive**:

```typescript
// lib/agent/context-builder.ts
// Only one of these runs — never both
if (agent.bookingConfig?.enabled) {
  tools.push(...buildSimpleBookingTools(agent))
} else if (agent.calendarAvailabilityConfig?.enabled) {
  tools.push(...buildCalendarAvailabilityTools(agent, connection))
}
```

`simple-booking` takes precedence when enabled. The existing scheduling feature is untouched.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/agents/schema.ts` | Modify | Add `bookingConfigSchema` + `bookableResourceSchema` (no TTL fields) |
| `lib/firestore-types.ts` | Modify | Add `BookingEnquiryDocument`, `Collections.bookingEnquiries` |
| `lib/agent/tools/simple-booking.ts` | Create | Feature entry point — exports `buildSimpleBookingTools(agent)` which returns both tools: `check_calendar_availability` and `submit_enquiry` |
| `lib/agent/context-builder.ts` | Modify | Mutually exclusive guard: `bookingConfig.enabled` → `buildSimpleBookingTools`, else existing `buildCalendarAvailabilityTools`. Also append booking system prompt when enabled. |
| `lib/booking-enquiries/create.ts` | Create | Save `BookingEnquiryDocument` to Firestore, trigger admin notification |
| `lib/booking-enquiries/ics.ts` | Create | Generate `.ics` file content (no external deps, pure string) |
| `lib/booking-enquiries/notify.ts` | Create | Send admin email via Resend with `.ics` attachment |
| `app/api/booking-enquiries/route.ts` | Create | Admin GET — list all enquiries for an agent |
| `app/api/calendar-connections/[id]/calendars/route.ts` | Create | Admin GET — list Google Calendars for a connection (used by resource config UI) |
| `components/agents/agent-booking-enquiries.tsx` | Create | Read-only table: guest name, email, phone, resource, dates, notes |

---

## Task 1: Firestore types + agent config schema

**Files:** `lib/agents/schema.ts`, `lib/firestore-types.ts`

- [ ] Add `bookableResourceSchema` and `bookingConfigSchema` to `lib/agents/schema.ts`
- [ ] Add `BookableResource`, `AgentBookingConfig`, and `BookingEnquiryDocument` interfaces to `lib/firestore-types.ts`
- [ ] Add `bookingEnquiries` path to `Collections`
- [ ] Add `bookingConfig?: AgentBookingConfig | null` to `VibeAgent` in `lib/types.ts`
- [ ] Update `lib/agent/context-builder.ts` — add mutually exclusive guard: register `buildSimpleBookingTools` when `bookingConfig.enabled`, otherwise fall through to existing `buildCalendarAvailabilityTools`. Do not modify `calendar-availability.ts`.
- [ ] Run `npx tsc --noEmit` — no errors
- [ ] Commit:
  ```bash
  git add lib/agents/schema.ts lib/firestore-types.ts lib/types.ts
  git commit -m "feat(booking-mini): add bookingConfig schema + BookingEnquiryDocument Firestore type"
  ```

---

## Task 2: `simple-booking` feature — both tools in one file

**File:** `lib/agent/tools/simple-booking.ts`

Both tools are defined and exported together. The file's public API is a single function:

```typescript
export function buildSimpleBookingTools(agent: VibeAgent): RegisteredTool[]
// Returns [] if bookingConfig is disabled or has no resources.
// Returns [check_calendar_availability, submit_enquiry] when enabled.
```

`context-builder.ts` calls this once and spreads the result — it has no knowledge of individual tools.

### `resolveResource` helper (internal to `simple-booking.ts`)

Used by both tools to look up a resource by name and fetch its calendar connection:

```typescript
interface ResolvedResource {
  resource: BookableResource
  connection: CalendarConnectionDocument
  calendarId: string
  calendarName: string
  timezone: string
}

async function resolveResource(
  agent: VibeAgent,
  resourceName: string
): Promise<ResolvedResource | null> {
  const resource = agent.bookingConfig!.resources.find(
    r => r.name.toLowerCase() === resourceName.toLowerCase()
  )
  if (!resource) return null

  const { getCalendarConnection } = await import('@/lib/scheduling/connections')
  const connection = await getCalendarConnection(agent.tenantId!, resource.calendarConnectionId)
  if (!connection) return null

  return {
    resource,
    connection,
    calendarId: resource.calendarId,
    calendarName: resource.calendarName,
    timezone: resource.timezone
  }
}
```

If `resolveResource` returns `null` (unknown name or broken connection), both tools return a user-friendly error immediately.

### Agent system prompt

When `bookingConfig.enabled`, append to the agent's system prompt:

```
You help guests check availability and submit booking enquiries.
Always call check_calendar_availability first before submit_enquiry.
Collect guest_name, guest_email, and guest_phone before submitting.
Never submit an enquiry without confirming availability first.
```

This goes in `context-builder.ts` alongside the tool registration — same pattern as other feature prompts.

### Tool 1: `check_calendar_availability`

- Takes: `resource_name`, `start_datetime`, `end_datetime`
- Validates:
  - **No past datetimes** — if `start_datetime` is before now, return a friendly error: `"Start date cannot be in the past."`
  - `end_datetime` must be after `start_datetime`
  - Invalid datetime format returns a clear message
- Resolves the resource → gets `calendarConnectionId` → calls Google Calendar freeBusy
- If **available**: returns confirmation string
- If **unavailable**: scans **both forward and backward** from the requested start (but never before today), returns up to 3 nearest free windows of the same duration — closest ones first
- Graceful OAuth failure: catch `getValidAccessToken` errors, return user-friendly message

**Next-slot suggestion logic:**
```
1. Call freeBusy for [now, requestedStart + 60 days]
2. Merge calendar busy slots into a blocked list, sorted by start
3. Scan forward from requestedStart — skip past blocked ranges, collect free windows
4. Scan backward from requestedStart — skip past blocked ranges, never go before now
5. Merge both directions, sort by proximity to requestedStart, take closest 3
6. Format each as: "[Resource] available [start] → [end] ([timezone])"
```

```typescript
// Tool description dynamically lists resource names so agent knows what to ask for
description: `Check if a resource is available for a date range. Available resources: ${resourceNames}. ` +
  `If unavailable, suggests up to 3 nearest free slots. ` +
  `Always call this before submit_enquiry.`
```

### Tool 2: `submit_enquiry`

- Takes: `resource_name`, `start_datetime`, `end_datetime`, `guest_name`, `guest_email` (required), `guest_phone` (required), `guest_count?`, `notes?`
- Validates:
  - **No past datetimes** — same check as `check_calendar_availability`
  - `end_datetime` must be after `start_datetime`
  - Email format check (basic RFC regex)
- Saves `BookingEnquiryDocument` to Firestore
- Fires admin email (fire-and-forget, failure logged not thrown)
- Returns: `"Enquiry submitted for [resource] from [start] to [end]. The host will contact you at [email]."`

```typescript
execute: async (args) => {
  // 1. Validate inputs
  // 2. resolveResource(agent, resourceName) — get calendar context (includes calendarId, calendarName)
  // 3. createEnquiry({
  //      ...guestDetails,
  //      resourceName: ctx.resource.name,
  //      calendarId: ctx.calendarId,          // ← flows from resolved resource
  //      calendarName: ctx.calendarName,      // ← human-readable name from calendarList
  //    }) — saves to Firestore, triggers admin email
  // 4. Return confirmation string to agent
}
```

> `calendarName` comes from the `BookableResource` config — stored when admin picks from the calendar dropdown. Add `calendarName: string` to `bookableResourceSchema` and `BookableResource` so it is persisted alongside `calendarId`.

- [ ] Write failing test: `__tests__/lib/agent/tools/simple-booking.test.ts`
  - `buildSimpleBookingTools` returns 2 tools when enabled with resources
  - returns `[]` when disabled or no resources
  - `check_calendar_availability` requires `resource_name`, `start_datetime`, `end_datetime`
  - `submit_enquiry` requires `resource_name`, `start_datetime`, `end_datetime`, `guest_name`, `guest_email`, `guest_phone`
  - tool descriptions both list available resource names
  - `check_calendar_availability` rejects a past `start_datetime`
  - `check_calendar_availability` returns nearest alternative slots when freeBusy shows unavailable
  - `submit_enquiry` rejects a past `start_datetime`
- [ ] Run test — FAIL
- [ ] Implement `lib/agent/tools/simple-booking.ts`
- [ ] Update `lib/agent/context-builder.ts` — import `buildSimpleBookingTools`, spread result into tool list
- [ ] Run test — PASS
- [ ] Run `npx tsc --noEmit` — no errors
- [ ] Commit:
  ```bash
  git add lib/agent/tools/simple-booking.ts lib/agent/context-builder.ts __tests__/lib/agent/tools/simple-booking.test.ts
  git commit -m "feat(simple-booking): register check_calendar_availability + submit_enquiry as one feature"
  ```

---

## Task 3: `createEnquiry` helper + admin email with ICS attachment

**Files:** `lib/booking-enquiries/create.ts`, `lib/booking-enquiries/ics.ts`, `lib/booking-enquiries/notify.ts`

### `create.ts`

```typescript
export async function createEnquiry(params: CreateEnquiryParams): Promise<string> {
  const now = new Date().toISOString()
  const ref = adminDb
    .collection(Collections.bookingEnquiries(params.agent.tenantId!, params.agent.id))
    .doc()

  const doc: BookingEnquiryDocument = {
    id: ref.id,
    agentId: params.agent.id,
    tenantId: params.agent.tenantId!,
    resourceName: params.resourceName,
    calendarId: params.calendarId,       // ← flows from resolveResource
    calendarName: params.calendarName,   // ← flows from resolveResource
    timezone: params.timezone,
    startDatetime: params.startDatetime,
    endDatetime: params.endDatetime,
    guestName: params.guestName,
    guestEmail: params.guestEmail,
    guestPhone: params.guestPhone,
    guestCount: params.guestCount,
    notes: params.notes,
    createdAt: now
  }

  await ref.set(doc)

  notifyAdminOfEnquiry(params.agent, doc).catch(err =>
    console.error('[booking-enquiry] Failed to notify admin:', err)
  )

  return ref.id
}
```

### `ics.ts` — generate ICS file content (no external dependency)

ICS is plain text — no library needed. Generate it inline.

**Timezone handling:** use `DTSTART;TZID=` format instead of converting to UTC. This avoids the JavaScript pitfall where `new Date("2026-05-10T14:00:00")` is parsed as server local time, not the resource's timezone. The wall-clock string is used as-is — the TZID tells calendar apps how to interpret it.

```typescript
export function generateIcs(params: {
  uid: string
  summary: string
  description: string
  startDatetime: string   // ISO wall-clock e.g. "2026-05-10T14:00:00" — no timezone suffix
  endDatetime: string
  timezone: string        // IANA tz e.g. "Asia/Kolkata" — used as TZID, not for conversion
  organizerEmail: string
}): string {
  // Format wall-clock string for ICS: "2026-05-10T14:00:00" → "20260510T140000"
  const fmtLocal = (iso: string) => iso.replace(/[-:]/g, '').replace('T', 'T').slice(0, 15)

  // DTSTAMP must be UTC
  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace('.000', '')

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VibeAgent//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${params.uid}@vibeagent`,
    `SUMMARY:${params.summary}`,
    `DESCRIPTION:${params.description.replace(/\n/g, '\\n')}`,
    `DTSTART;TZID=${params.timezone}:${fmtLocal(params.startDatetime)}`,  // ← wall-clock + TZID
    `DTEND;TZID=${params.timezone}:${fmtLocal(params.endDatetime)}`,
    `ORGANIZER:mailto:${params.organizerEmail}`,
    `DTSTAMP:${dtstamp}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')
}
```

### `notify.ts` — admin email via Resend with `.ics` attachment

Email contains:
- Guest name, email, phone
- Resource name + dates (formatted in resource timezone)
- Guest count + notes
- **"Add to calendar: [calendarName]"** — tells admin exactly which Google Calendar to save the ICS into
- Direct link: `${appUrl}/agents/${agentId}?tab=booking-enquiries`
- **`.ics` file attached** — admin clicks it to instantly add to Google Calendar, Apple Calendar, Outlook, etc.

```typescript
import { generateIcs } from './ics'

// Inside notifyAdminOfEnquiry:
const icsContent = generateIcs({
  uid: request.id,
  summary: `${request.resourceName} — ${request.guestName}`,
  description: [
    `Guest: ${request.guestName}`,
    `Email: ${request.guestEmail}`,
    `Phone: ${request.guestPhone}`,
    request.guestCount ? `Guests: ${request.guestCount}` : null,
    request.notes ? `Notes: ${request.notes}` : null,
    ``,
    `Add to calendar: ${request.calendarName}`,  // ← tells admin which calendar to save to
    `Calendar ID: ${request.calendarId}`          // ← for reference
  ].filter(Boolean).join('\n'),
  startDatetime: request.startDatetime,
  endDatetime: request.endDatetime,
  timezone: request.timezone,
  organizerEmail: toAddress
})

await new Resend(apiKey).emails.send({
  from: process.env.NOTIFICATION_EMAIL_FROM || 'VibeAgent <notifications@vibeagent.com>',
  to: toAddress,
  subject: `New booking enquiry — ${request.resourceName}`,
  text: emailBody,
  attachments: [
    {
      filename: `booking-${request.id}.ics`,
      content: Buffer.from(icsContent).toString('base64'),
      contentType: 'text/calendar; method=REQUEST'
    }
  ]
})
```

- [ ] Implement `lib/booking-enquiries/ics.ts` — no external deps, pure string generation
- [ ] Write unit test for `generateIcs` — verify output contains `BEGIN:VCALENDAR`, correct `DTSTART`, `DTEND`, `UID`, `SUMMARY`
- [ ] Implement `lib/booking-enquiries/create.ts`
- [ ] Implement `lib/booking-enquiries/notify.ts` — attach ICS
- [ ] Run `npx tsc --noEmit` — no errors
- [ ] Commit:
  ```bash
  git add lib/booking-enquiries/ics.ts lib/booking-enquiries/create.ts lib/booking-enquiries/notify.ts
  git commit -m "feat(simple-booking): createEnquiry helper + admin email with .ics calendar attachment"
  ```

---

## Task 4: Admin GET API + simple table UI

**Files:** `app/api/booking-enquiries/route.ts`, `components/agents/agent-booking-enquiries.tsx`

### API — `GET /api/booking-enquiries?agentId=xxx`

```typescript
export async function GET(req: NextRequest) {
  const tenantId = await getAuthenticatedTenantId(req)
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agentId = new URL(req.url).searchParams.get('agentId')
  if (!agentId) return NextResponse.json({ error: 'agentId is required' }, { status: 400 })

  const snap = await adminDb
    .collectionGroup('bookingEnquiries')
    .where('tenantId', '==', tenantId)
    .where('agentId', '==', agentId)
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()

  return NextResponse.json({ enquiries: snap.docs.map(d => d.data()) })
}
```

### UI — `agent-booking-enquiries.tsx`

Simple read-only table. Columns:

| Column | Value |
|--------|-------|
| Guest | Name + email + phone |
| Resource | Resource name |
| Dates | Start → End (resource timezone) |
| Guests | Guest count |
| Notes | Notes (truncated) |
| Received | `createdAt` formatted |

No actions. No status. Admin reads, opens calendar manually.

- [ ] Implement `app/api/booking-enquiries/route.ts`
- [ ] Implement `components/agents/agent-booking-enquiries.tsx` — table with columns above
- [ ] Add `bookingEnquiries` composite index to `firestore.indexes.json`:
  ```json
  {
    "collectionGroup": "bookingEnquiries",
    "queryScope": "COLLECTION_GROUP",
    "fields": [
      { "fieldPath": "tenantId", "order": "ASCENDING" },
      { "fieldPath": "agentId", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" }
    ]
  }
  ```
- [ ] Wire tab in `components/agents/agent-dashboard-tabs.tsx` — show "Enquiries" tab when `bookingConfig?.enabled`
- [ ] Commit:
  ```bash
  git add app/api/booking-enquiries/route.ts components/agents/agent-booking-enquiries.tsx firestore.indexes.json components/agents/agent-dashboard-tabs.tsx
  git commit -m "feat(booking-mini): admin enquiries API + simple read-only table UI"
  ```

---

## Task 5: Calendar list API + resource config UI

### How calendar selection works

Guest picks a resource by **name** (e.g. "Glass Cabin"). The agent resolves `calendarId` from the resource config — guest never sees a calendar ID.

Admin sets up the mapping once in the resource config UI:

```
Admin flow:
1. Clicks "Add Resource"
2. Types resource name: "Glass Cabin"
3. Selects a calendar connection (existing Google OAuth)
4. Dropdown fetches their Google Calendars for that connection
5. Admin picks "Glass Cabin" from the list
6. calendarId is stored in BookableResource — done
```

---

### New API: `GET /api/calendar-connections/[id]/calendars`

Fetches the list of calendars the admin has access to under a given OAuth connection. Used only by the resource config UI — never called at enquiry time.

```typescript
// app/api/calendar-connections/[id]/calendars/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedTenantId } from '@/lib/auth/server'
import { getCalendarConnection, getValidAccessToken } from '@/lib/scheduling/connections'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const tenantId = await getAuthenticatedTenantId(req)
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const connection = await getCalendarConnection(tenantId, params.id)
  if (!connection) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  const accessToken = await getValidAccessToken(connection)

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!res.ok) return NextResponse.json({ error: 'Failed to fetch calendars' }, { status: 502 })

  const data = await res.json()
  const calendars = (data.items ?? []).map((c: { id: string; summary: string }) => ({
    id: c.id,
    name: c.summary
  }))

  return NextResponse.json({ calendars })
}
```

`minAccessRole=writer` filters to calendars the admin can actually write to — no read-only calendars shown.

---

### Resource config UI — `agent-booking-resource-config.tsx`

When admin selects a `calendarConnectionId`, the UI fetches `/api/calendar-connections/{id}/calendars` and renders a dropdown of calendar names. Admin picks one → `calendarId` is stored.

```
[ Resource name    ] [ Calendar Connection ▾ ] [ Calendar ▾      ] [ Add ]
  Glass Cabin         My Google Account          Glass Cabin Cal
  Pool Villa          My Google Account          Pool Villa Cal
```

- When admin picks a calendar from the dropdown, store **both** `calendarId` and `calendarName` in `BookableResource` — name is needed for the admin email
- Selecting a different connection re-fetches the calendar list and clears the calendar selection
- Shows loading state while fetching
- Shows error if fetch fails ("Could not load calendars — check your connection")

**Files:**
- Create: `app/api/calendar-connections/[id]/calendars/route.ts`
- Create: `components/agents/agent-booking-resource-config.tsx`
- Modify: agent settings page (wherever `calendarAvailabilityConfig` is currently rendered — add a `simple-booking` section below it, guarded by a feature toggle)

**Wiring into agent settings:**

Find the existing agent settings page (likely `components/agents/agent-settings.tsx` or similar). Add a "Simple Booking" section:

```tsx
{/* Simple Booking */}
<section>
  <div className="flex items-center justify-between">
    <h3 className="font-medium">Simple Booking</h3>
    <Switch
      checked={agent.bookingConfig?.enabled ?? false}
      onCheckedChange={val => updateAgent({ bookingConfig: { ...agent.bookingConfig, enabled: val } })}
    />
  </div>
  {agent.bookingConfig?.enabled && (
    <AgentBookingResourceConfig
      resources={agent.bookingConfig.resources ?? []}
      calendarConnections={calendarConnections}
      onChange={resources => updateAgent({ bookingConfig: { ...agent.bookingConfig, resources } })}
    />
  )}
</section>
```

- [ ] Implement `app/api/calendar-connections/[id]/calendars/route.ts`
- [ ] Implement `components/agents/agent-booking-resource-config.tsx` — resource list + add form with calendar picker dropdown
- [ ] Wire `AgentBookingResourceConfig` into agent settings page with enable/disable toggle
- [ ] Run `npx tsc --noEmit` — no errors
- [ ] Commit:
  ```bash
  git add app/api/calendar-connections/[id]/calendars/route.ts components/agents/agent-booking-resource-config.tsx
  git commit -m "feat(simple-booking): calendar list API + resource config UI with calendar picker"
  ```

---

## What is NOT in this plan (deliberately excluded)

- Approval / reject flow — admin acts manually from email
- Soft-block / TTL / expiry cron — no hold logic
- Guest notifications after submit — agent message is the only confirmation
- Guest cancellation or modification
- WhatsApp notifications
- Double-booking prevention — admin is responsible for checking before adding to calendar
- Payment integration
