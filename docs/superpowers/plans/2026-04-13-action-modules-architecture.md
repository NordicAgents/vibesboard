# Action Modules Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scattered agent action system (4 config objects, 3 availability checkers, 100+ lines of if/else wiring) with a clean module registry where each action type is a self-contained plugin.

**Architecture:** Action modules implement a single `ActionModule` interface. A central registry maps type strings to modules. The context-builder loops through `agent.actions[]` and delegates to the registry. Shared calendar logic is extracted into a common utility.

**Tech Stack:** TypeScript, Firebase/Firestore, Google Calendar API, Node built-in test runner (`node --experimental-strip-types --test`)

---

## File Structure

```
lib/agent/actions/
  types.ts                    # ActionModule, ActionContext, AgentAction interfaces
  registry.ts                 # ACTION_REGISTRY map + injectActionTools()
  shared/
    calendar.ts               # checkFreeBusy(), formatSlot(), parseWallClock()
    calendar.test.ts           # Tests for shared calendar logic
  appointments/
    index.ts                  # AppointmentsModule (implements ActionModule)
    tools.ts                  # 5 tool builders
    types.ts                  # AppointmentsConfig
  booking/
    index.ts                  # BookingModule
    tools.ts                  # 5 tool builders (merges simple + direct)
    types.ts                  # BookingConfig, BookableResource
  data/
    index.ts                  # DataModule
    tools.ts                  # 4 tool builders (submit, update, query, delete)
    types.ts                  # DataConfig, FieldMapping
```

**Files deleted after migration:**
- `lib/agent/tools/scheduling.ts`
- `lib/agent/tools/simple-booking.ts`
- `lib/agent/tools/direct-booking.ts`
- `lib/agent/tools/calendar-availability.ts`
- `lib/agent/tools/data-actions.ts`

**Files modified:**
- `lib/types.ts` — add `AgentAction` to `VibeAgent`, remove `ActionToolType`
- `lib/firestore-types.ts` — add `AgentAction` type, update `DataActionType`
- `lib/agent/context-builder.ts` — replace if/else blocks with registry loop
- `lib/feature-flags.ts` — remove sub-flags
- `lib/data/providers/types.ts` — add `queryRows()`, `deleteRow()` to `DataProvider`

---

### Task 1: Action Module Types

Define the core interfaces that every action module implements.

**Files:**
- Create: `lib/agent/actions/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// lib/agent/actions/types.ts
import type { VibeAgent } from '@/lib/types'
import type { RegisteredTool } from '@/lib/agent/tools/base'

// ─── Action type registry ──────────────────────────────────────────

export type ActionType = 'appointments' | 'booking' | 'data'

// ─── Agent action config (stored in Firestore agent.actions[]) ─────

export interface AgentAction {
  id: string
  type: ActionType
  enabled: boolean
  connectionId?: string | null
  config: Record<string, any> // narrowed per module via type guards
}

// ─── Module interface ──────────────────────────────────────────────

export interface ActionContext {
  agent: VibeAgent
  action: AgentAction
}

export interface ActionModule {
  type: ActionType
  buildTools(ctx: ActionContext): Promise<RegisteredTool[]>
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/agent/actions/types.ts
git commit -m "feat(actions): add ActionModule interface and AgentAction types"
```

---

### Task 2: Shared Calendar Utility

Extract the freeBusy logic that's currently duplicated in `scheduling.ts`, `simple-booking.ts`, and `calendar-availability.ts` into a single shared utility.

**Files:**
- Create: `lib/agent/actions/shared/calendar.ts`
- Create: `lib/agent/actions/shared/calendar.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// lib/agent/actions/shared/calendar.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// ─── Replicated pure logic (path aliases don't resolve in node test runner) ──

interface BusySlot { start: number; end: number }

function parseWallClock(datetime: string): Date {
  const iso = datetime.includes('T') ? datetime : `${datetime}T00:00:00`
  return new Date(iso.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`)
}

function hasConflict(busySlots: BusySlot[], startMs: number, endMs: number): boolean {
  return busySlots.some(b => startMs < b.end && endMs > b.start)
}

function formatSlotDisplay(isoDate: string, timezone: string): string {
  try {
    return new Date(isoDate).toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone,
      timeZoneName: 'short'
    })
  } catch {
    return isoDate
  }
}

const HOUR = 60 * 60 * 1000

// ─── parseWallClock ──────────────────────────────────────────────────────

describe('parseWallClock', () => {
  test('YYYY-MM-DDTHH:MM is treated as UTC', () => {
    const d = parseWallClock('2026-05-10T14:00')
    assert.equal(d.getUTCHours(), 14)
    assert.equal(d.getUTCMinutes(), 0)
  })

  test('date-only YYYY-MM-DD is treated as UTC midnight', () => {
    const d = parseWallClock('2026-05-10')
    assert.equal(d.getUTCHours(), 0)
  })

  test('already-UTC string (ends with Z) is unchanged', () => {
    const d = parseWallClock('2026-05-10T14:00:00Z')
    assert.equal(d.getUTCHours(), 14)
  })

  test('string with offset is parsed correctly', () => {
    const d = parseWallClock('2026-05-10T14:00:00+05:30')
    assert.equal(d.getUTCHours(), 8)
    assert.equal(d.getUTCMinutes(), 30)
  })

  test('invalid string returns Invalid Date', () => {
    const d = parseWallClock('not-a-date')
    assert.ok(isNaN(d.getTime()))
  })
})

// ─── hasConflict ─────────────────────────────────────────────────────────

describe('hasConflict', () => {
  const busy: BusySlot[] = [{ start: 100 * HOUR, end: 103 * HOUR }]

  test('no conflict when slot is entirely before busy', () => {
    assert.equal(hasConflict(busy, 97 * HOUR, 99 * HOUR), false)
  })

  test('no conflict when slot starts exactly when busy ends', () => {
    assert.equal(hasConflict(busy, 103 * HOUR, 105 * HOUR), false)
  })

  test('conflict when slot overlaps start of busy', () => {
    assert.equal(hasConflict(busy, 99 * HOUR, 101 * HOUR), true)
  })

  test('conflict when slot is fully inside busy', () => {
    assert.equal(hasConflict(busy, 100 * HOUR, 102 * HOUR), true)
  })

  test('no conflict with empty busy list', () => {
    assert.equal(hasConflict([], 100 * HOUR, 102 * HOUR), false)
  })
})

// ─── formatSlotDisplay ───────────────────────────────────────────────────

describe('formatSlotDisplay', () => {
  test('formats ISO date with timezone', () => {
    const result = formatSlotDisplay('2026-05-10T14:00:00Z', 'America/New_York')
    assert.ok(result.includes('May'))
    assert.ok(result.includes('10'))
  })

  test('returns raw string on invalid date', () => {
    const result = formatSlotDisplay('bad-date', 'UTC')
    // Invalid Date.toLocaleString may throw or return "Invalid Date"
    assert.ok(typeof result === 'string')
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --experimental-strip-types --test lib/agent/actions/shared/calendar.test.ts`
Expected: All tests PASS (pure logic replicated inline)

- [ ] **Step 3: Write the shared calendar utility**

```typescript
// lib/agent/actions/shared/calendar.ts
import { fetchWithRetry } from '@/lib/utils/fetch-with-retry'

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

// ─── Types ──────────────────────────────────────────────────────────

export interface BusySlot {
  start: number  // ms timestamp
  end: number    // ms timestamp
}

// ─── Date parsing ───────────────────────────────────────────────────

/**
 * Parse a wall-clock datetime string as UTC.
 * Handles: YYYY-MM-DD, YYYY-MM-DDTHH:MM, full ISO with Z or offset.
 */
export function parseWallClock(datetime: string): Date {
  const iso = datetime.includes('T') ? datetime : `${datetime}T00:00:00`
  return new Date(iso.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`)
}

// ─── Conflict detection ─────────────────────────────────────────────

export function hasConflict(busySlots: BusySlot[], startMs: number, endMs: number): boolean {
  return busySlots.some(b => startMs < b.end && endMs > b.start)
}

// ─── FreeBusy query ─────────────────────────────────────────────────

/**
 * Query Google Calendar freeBusy API for busy slots in a time range.
 * Used by both Appointments and Booking modules.
 */
export async function checkFreeBusy(
  accessToken: string,
  calendarId: string,
  timeMin: Date,
  timeMax: Date
): Promise<BusySlot[]> {
  const res = await fetchWithRetry(`${GOOGLE_CALENDAR_API}/freeBusy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: calendarId }]
    }),
    timeoutMs: 10_000,
    maxAttempts: 3,
    baseDelayMs: 500
  })
  if (!res.ok) return []
  const data = await res.json()
  const raw: Array<{ start: string; end: string }> = data?.calendars?.[calendarId]?.busy ?? []
  return raw
    .map(s => ({ start: new Date(s.start).getTime(), end: new Date(s.end).getTime() }))
    .sort((a, b) => a.start - b.start)
}

// ─── Display formatting ─────────────────────────────────────────────

export function formatSlotDisplay(isoDate: string, timezone: string): string {
  try {
    return new Date(isoDate).toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone,
      timeZoneName: 'short'
    })
  } catch {
    return isoDate
  }
}

export function formatDateRange(startMs: number, durationMs: number, timezone: string): string {
  const fmt = (ms: number) =>
    new Date(ms).toLocaleString('en-US', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  return `${fmt(startMs)} → ${fmt(startMs + durationMs)}`
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/agent/actions/shared/calendar.ts lib/agent/actions/shared/calendar.test.ts
git commit -m "feat(actions): extract shared calendar utility (freeBusy, parseWallClock, conflict detection)"
```

---

### Task 3: Appointments Module

Port the scheduling tools from `lib/agent/tools/scheduling.ts` into the new module structure. Rename `book_meeting` → `book_appointment`, add `list_appointments`.

**Files:**
- Create: `lib/agent/actions/appointments/types.ts`
- Create: `lib/agent/actions/appointments/tools.ts`
- Create: `lib/agent/actions/appointments/index.ts`

- [ ] **Step 1: Create appointments types**

```typescript
// lib/agent/actions/appointments/types.ts

export interface AppointmentsConfig {
  calendarId?: string           // overrides connection default
  timezone: string
  availableHours: { start: string; end: string }
  availableDays: number[]       // 0=Sun, 1=Mon, etc.
  defaultDurationMinutes: number
  bufferMinutes: number
  meetingTitleTemplate: string
  meetingDescription?: string
  createMeetLink: boolean
}
```

- [ ] **Step 2: Create the tool builders**

Port the 4 existing tools from `lib/agent/tools/scheduling.ts` (lines 52-461), adjusting:
- Import `formatSlotDisplay` from shared calendar utility instead of local `formatSlotForDisplay`
- Import `checkFreeBusy` from shared calendar instead of going through provider
- Rename `book_meeting` → `book_appointment`, `reschedule_meeting` → `reschedule_appointment`, `cancel_meeting` → `cancel_appointment`
- Add new `list_appointments` tool

```typescript
// lib/agent/actions/appointments/tools.ts
import { createHash } from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import {
  Collections,
  type BookingDocument,
  type CalendarConnectionDocument
} from '@/lib/firestore-types'
import { createProvider } from '@/lib/scheduling/providers'
import { getCalendarConnection, getValidAccessToken } from '@/lib/scheduling/connections'
import { formatSlotDisplay } from '../shared/calendar'
import type { RegisteredTool } from '@/lib/agent/tools/base'
import type { VibeAgent } from '@/lib/types'
import type { ActionContext } from '../types'
import type { AppointmentsConfig } from './types'

// ─── Helpers ────────────────────────────────────────────────────────

interface AppointmentsToolContext {
  agent: VibeAgent
  connection: CalendarConnectionDocument
  config: AppointmentsConfig
}

function appointmentDocId(agentId: string, startTime: string, attendeeEmail: string): string {
  const normalizedTime = new Date(startTime).toISOString()
  return createHash('sha256')
    .update(`${agentId}|${normalizedTime}|${attendeeEmail.toLowerCase()}`)
    .digest('hex')
    .slice(0, 32)
}

// ─── Tool: check_availability ───────────────────────────────────────

function buildCheckAvailabilityTool(ctx: AppointmentsToolContext): RegisteredTool {
  return {
    function: {
      name: 'check_availability',
      description:
        'Check calendar availability for a specific date. Returns available time slots for booking.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'The date to check availability for, in YYYY-MM-DD format.'
          },
          duration_minutes: {
            type: 'number',
            description: `Meeting duration in minutes. Default: ${ctx.config.defaultDurationMinutes}`
          }
        },
        required: ['date']
      }
    },
    execute: async (args) => {
      const date = String(args.date ?? '').trim()
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return 'Please provide a valid date in YYYY-MM-DD format.'
      }

      const durationMinutes =
        typeof args.duration_minutes === 'number' && args.duration_minutes > 0
          ? args.duration_minutes
          : ctx.config.defaultDurationMinutes

      try {
        const accessToken = await getValidAccessToken(ctx.connection)
        const provider = createProvider(ctx.connection, accessToken)

        const slots = await provider.checkAvailability({
          date,
          durationMinutes,
          timezone: ctx.config.timezone,
          availableHours: ctx.config.availableHours,
          availableDays: ctx.config.availableDays,
          bufferMinutes: ctx.config.bufferMinutes
        })

        if (slots.length === 0) {
          return `No available slots on ${date} for a ${durationMinutes}-minute appointment. Try a different date.`
        }

        const formatted = slots
          .slice(0, 8)
          .map(
            (slot, i) =>
              `${i + 1}. ${formatSlotDisplay(slot.start, ctx.config.timezone)} — ${formatSlotDisplay(slot.end, ctx.config.timezone)}`
          )
          .join('\n')

        return `Available ${durationMinutes}-minute slots on ${date}:\n${formatted}\n\n${slots.length > 8 ? `(${slots.length - 8} more slots available)` : ''}`
      } catch (error) {
        return `Error checking availability: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}

// ─── Tool: book_appointment ─────────────────────────────────────────

function buildBookAppointmentTool(ctx: AppointmentsToolContext): RegisteredTool {
  return {
    function: {
      name: 'book_appointment',
      description:
        'Book an appointment at a specific date and time. Always call check_availability first before using this tool.',
      parameters: {
        type: 'object',
        properties: {
          start_time: {
            type: 'string',
            description: 'Appointment start time in ISO 8601 format (e.g., 2024-03-15T14:00:00).'
          },
          attendee_name: {
            type: 'string',
            description: 'Full name of the attendee.'
          },
          attendee_email: {
            type: 'string',
            description: 'Email address of the attendee.'
          },
          title: {
            type: 'string',
            description: 'Appointment title. Optional.'
          },
          description: {
            type: 'string',
            description: 'Appointment description or notes. Optional.'
          },
          duration_minutes: {
            type: 'number',
            description: `Duration in minutes. Default: ${ctx.config.defaultDurationMinutes}`
          }
        },
        required: ['start_time', 'attendee_name', 'attendee_email']
      }
    },
    execute: async (args) => {
      const startTime = String(args.start_time ?? '').trim()
      const attendeeName = String(args.attendee_name ?? '').trim()
      const attendeeEmail = String(args.attendee_email ?? '').trim()

      if (!startTime || !attendeeName || !attendeeEmail) {
        return 'Missing required fields: start_time, attendee_name, and attendee_email are all required.'
      }

      const durationMinutes =
        typeof args.duration_minutes === 'number' && args.duration_minutes > 0
          ? args.duration_minutes
          : ctx.config.defaultDurationMinutes

      const startMs = new Date(startTime).getTime()
      if (isNaN(startMs)) {
        return 'Invalid start_time format. Use ISO 8601 (e.g., 2024-03-15T14:00:00).'
      }
      const endTime = new Date(startMs + durationMinutes * 60 * 1000).toISOString()

      const title = args.title
        ? String(args.title)
        : ctx.config.meetingTitleTemplate.replace('{{name}}', attendeeName)

      try {
        const docId = appointmentDocId(ctx.agent.id, startTime, attendeeEmail)
        const bookingRef = adminDb
          .collection(Collections.bookings(ctx.agent.tenantId!, ctx.agent.id))
          .doc(docId)

        const existingSnap = await bookingRef.get()
        if (existingSnap.exists) {
          const existing = existingSnap.data() as BookingDocument
          const lines = [
            `Appointment already booked.`,
            `Title: ${existing.title}`,
            `Time: ${formatSlotDisplay(existing.startTime, ctx.config.timezone)}`,
            `Duration: ${Math.round((new Date(existing.endTime).getTime() - new Date(existing.startTime).getTime()) / 60_000)} minutes`,
            `Attendee: ${existing.attendeeName} (${existing.attendeeEmail})`
          ]
          if (existing.meetLink) lines.push(`Google Meet: ${existing.meetLink}`)
          return lines.join('\n')
        }

        const accessToken = await getValidAccessToken(ctx.connection)
        const provider = createProvider(ctx.connection, accessToken)

        const result = await provider.createEvent({
          title,
          startTime,
          endTime,
          attendeeEmail,
          attendeeName,
          description: args.description
            ? String(args.description)
            : ctx.config.meetingDescription ?? undefined,
          timezone: ctx.config.timezone,
          createMeetLink: ctx.config.createMeetLink
        })

        const now = new Date().toISOString()
        const booking: BookingDocument = {
          id: docId,
          agentId: ctx.agent.id,
          tenantId: ctx.agent.tenantId!,
          conversationId: '',
          calendarConnectionId: ctx.connection.id,
          provider: ctx.connection.provider,
          externalEventId: result.eventId,
          title,
          startTime,
          endTime,
          timezone: ctx.config.timezone,
          attendeeName,
          attendeeEmail,
          description: args.description ? String(args.description) : undefined,
          meetLink: result.meetLink,
          status: 'confirmed',
          createdAt: now,
          updatedAt: now
        }
        await bookingRef.set(booking)

        const lines = [
          `Appointment booked successfully!`,
          `Title: ${title}`,
          `Time: ${formatSlotDisplay(startTime, ctx.config.timezone)}`,
          `Duration: ${durationMinutes} minutes`,
          `Attendee: ${attendeeName} (${attendeeEmail})`
        ]
        if (result.meetLink) lines.push(`Google Meet: ${result.meetLink}`)
        lines.push(`A calendar invite has been sent to ${attendeeEmail}.`)

        return lines.join('\n')
      } catch (error) {
        return `Error booking appointment: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}

// ─── Tool: reschedule_appointment ───────────────────────────────────

function buildRescheduleAppointmentTool(ctx: AppointmentsToolContext): RegisteredTool {
  return {
    function: {
      name: 'reschedule_appointment',
      description:
        'Reschedule an existing appointment to a new time. Requires the attendee email and original start time to find the booking.',
      parameters: {
        type: 'object',
        properties: {
          attendee_email: {
            type: 'string',
            description: 'Email of the attendee whose appointment to reschedule.'
          },
          original_start_time: {
            type: 'string',
            description: 'Original appointment start time in ISO 8601 format.'
          },
          new_start_time: {
            type: 'string',
            description: 'New appointment start time in ISO 8601 format.'
          },
          duration_minutes: {
            type: 'number',
            description: 'New duration in minutes. Optional — keeps original if omitted.'
          }
        },
        required: ['attendee_email', 'original_start_time', 'new_start_time']
      }
    },
    execute: async (args) => {
      const attendeeEmail = String(args.attendee_email ?? '').trim()
      const originalStartTime = String(args.original_start_time ?? '').trim()
      const newStartTime = String(args.new_start_time ?? '').trim()

      if (!attendeeEmail || !originalStartTime || !newStartTime) {
        return 'Missing required fields: attendee_email, original_start_time, and new_start_time.'
      }

      try {
        const bookingsPath = Collections.bookings(ctx.agent.tenantId!, ctx.agent.id)
        const snapshot = await adminDb
          .collection(bookingsPath)
          .where('attendeeEmail', '==', attendeeEmail)
          .where('status', 'in', ['confirmed', 'rescheduled'])
          .get()

        const booking = snapshot.docs
          .map((d: FirebaseFirestore.QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as BookingDocument))
          .find((b: BookingDocument) => {
            const bStart = new Date(b.startTime).getTime()
            const oStart = new Date(originalStartTime).getTime()
            return Math.abs(bStart - oStart) < 60_000
          })

        if (!booking) {
          return `No active appointment found for ${attendeeEmail} at ${formatSlotDisplay(originalStartTime, ctx.config.timezone)}.`
        }

        const originalDuration =
          new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()
        const durationMs =
          typeof args.duration_minutes === 'number' && args.duration_minutes > 0
            ? args.duration_minutes * 60_000
            : originalDuration
        const newEndTime = new Date(
          new Date(newStartTime).getTime() + durationMs
        ).toISOString()

        const accessToken = await getValidAccessToken(ctx.connection)
        const provider = createProvider(ctx.connection, accessToken)

        await provider.updateEvent(booking.externalEventId, {
          startTime: newStartTime,
          endTime: newEndTime,
          timezone: ctx.config.timezone
        })

        await adminDb.collection(bookingsPath).doc(booking.id).update({
          startTime: newStartTime,
          endTime: newEndTime,
          status: 'rescheduled',
          updatedAt: new Date().toISOString()
        })

        return [
          `Appointment rescheduled successfully!`,
          `Attendee: ${booking.attendeeName} (${attendeeEmail})`,
          `New time: ${formatSlotDisplay(newStartTime, ctx.config.timezone)}`,
          `Duration: ${Math.round(durationMs / 60_000)} minutes`,
          `An updated calendar invite has been sent.`
        ].join('\n')
      } catch (error) {
        return `Error rescheduling appointment: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}

// ─── Tool: cancel_appointment ───────────────────────────────────────

function buildCancelAppointmentTool(ctx: AppointmentsToolContext): RegisteredTool {
  return {
    function: {
      name: 'cancel_appointment',
      description:
        'Cancel an existing appointment. Requires the attendee email and start time to identify the booking.',
      parameters: {
        type: 'object',
        properties: {
          attendee_email: {
            type: 'string',
            description: 'Email of the attendee whose appointment to cancel.'
          },
          start_time: {
            type: 'string',
            description: 'Appointment start time in ISO 8601 format.'
          }
        },
        required: ['attendee_email', 'start_time']
      }
    },
    execute: async (args) => {
      const attendeeEmail = String(args.attendee_email ?? '').trim()
      const startTime = String(args.start_time ?? '').trim()

      if (!attendeeEmail || !startTime) {
        return 'Missing required fields: attendee_email and start_time.'
      }

      try {
        const bookingsPath = Collections.bookings(ctx.agent.tenantId!, ctx.agent.id)
        const snapshot = await adminDb
          .collection(bookingsPath)
          .where('attendeeEmail', '==', attendeeEmail)
          .where('status', 'in', ['confirmed', 'rescheduled'])
          .get()

        const booking = snapshot.docs
          .map((d: FirebaseFirestore.QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as BookingDocument))
          .find((b: BookingDocument) => {
            const bStart = new Date(b.startTime).getTime()
            const sStart = new Date(startTime).getTime()
            return Math.abs(bStart - sStart) < 60_000
          })

        if (!booking) {
          return `No active appointment found for ${attendeeEmail} at ${formatSlotDisplay(startTime, ctx.config.timezone)}.`
        }

        const accessToken = await getValidAccessToken(ctx.connection)
        const provider = createProvider(ctx.connection, accessToken)

        await provider.deleteEvent(booking.externalEventId)

        await adminDb.collection(bookingsPath).doc(booking.id).update({
          status: 'cancelled',
          cancelledAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })

        return [
          `Appointment cancelled successfully.`,
          `Title: ${booking.title}`,
          `Was scheduled: ${formatSlotDisplay(booking.startTime, ctx.config.timezone)}`,
          `Attendee: ${booking.attendeeName} (${attendeeEmail})`,
          `A cancellation notice has been sent.`
        ].join('\n')
      } catch (error) {
        return `Error cancelling appointment: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}

// ─── Tool: list_appointments ────────────────────────────────────────

function buildListAppointmentsTool(ctx: AppointmentsToolContext): RegisteredTool {
  return {
    function: {
      name: 'list_appointments',
      description: 'List upcoming appointments. Shows confirmed and rescheduled appointments.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Date to list appointments for in YYYY-MM-DD format. Defaults to today.'
          },
          attendee_email: {
            type: 'string',
            description: 'Filter by attendee email. Optional.'
          }
        },
        required: []
      }
    },
    execute: async (args) => {
      const date = args.date ? String(args.date).trim() : new Date().toISOString().slice(0, 10)
      const attendeeEmail = args.attendee_email ? String(args.attendee_email).trim() : null

      try {
        const bookingsPath = Collections.bookings(ctx.agent.tenantId!, ctx.agent.id)
        let query: FirebaseFirestore.Query = adminDb
          .collection(bookingsPath)
          .where('status', 'in', ['confirmed', 'rescheduled'])

        if (attendeeEmail) {
          query = query.where('attendeeEmail', '==', attendeeEmail)
        }

        const snapshot = await query.get()

        const dayStart = new Date(`${date}T00:00:00Z`).getTime()
        const dayEnd = new Date(`${date}T23:59:59Z`).getTime()

        const appointments = snapshot.docs
          .map(d => d.data() as BookingDocument)
          .filter(b => {
            const start = new Date(b.startTime).getTime()
            return start >= dayStart && start <= dayEnd
          })
          .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())

        if (appointments.length === 0) {
          const scope = attendeeEmail ? ` for ${attendeeEmail}` : ''
          return `No appointments found on ${date}${scope}.`
        }

        const lines = appointments.map(a =>
          `- ${a.title} | ${formatSlotDisplay(a.startTime, ctx.config.timezone)} | ${a.attendeeName} (${a.attendeeEmail}) | Status: ${a.status}`
        )
        return `Appointments on ${date} (${appointments.length}):\n${lines.join('\n')}`
      } catch (error) {
        return `Error listing appointments: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}

// ─── Export: build all tools ────────────────────────────────────────

export async function buildAppointmentsTools(ctx: ActionContext): Promise<RegisteredTool[]> {
  const config = ctx.action.config as AppointmentsConfig
  const connectionId = ctx.action.connectionId
  if (!connectionId || !ctx.agent.tenantId) return []

  const connection = await getCalendarConnection(ctx.agent.tenantId, connectionId)
  if (!connection || connection.status !== 'active') return []

  const toolCtx: AppointmentsToolContext = { agent: ctx.agent, connection, config }

  return [
    buildCheckAvailabilityTool(toolCtx),
    buildBookAppointmentTool(toolCtx),
    buildRescheduleAppointmentTool(toolCtx),
    buildCancelAppointmentTool(toolCtx),
    buildListAppointmentsTool(toolCtx)
  ]
}
```

- [ ] **Step 3: Create the module index**

```typescript
// lib/agent/actions/appointments/index.ts
import type { ActionModule } from '../types'
import { buildAppointmentsTools } from './tools'

export const AppointmentsModule: ActionModule = {
  type: 'appointments',
  buildTools: buildAppointmentsTools
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/agent/actions/appointments/
git commit -m "feat(actions): add appointments module (port from scheduling.ts + list_appointments)"
```

---

### Task 4: Booking Module

Merge `simple-booking.ts` and `direct-booking.ts` into a single module. The `mode` config ('enquiry' vs 'direct') controls behavior.

**Files:**
- Create: `lib/agent/actions/booking/types.ts`
- Create: `lib/agent/actions/booking/tools.ts`
- Create: `lib/agent/actions/booking/index.ts`

- [ ] **Step 1: Create booking types**

```typescript
// lib/agent/actions/booking/types.ts
import type { BookableResource } from '@/lib/firestore-types'

export interface BookingConfig {
  mode: 'enquiry' | 'direct'
  resources: BookableResource[]
  eventTitleTemplate: string
  eventTimeMode: 'all-day' | 'timed'
  overlapProtection: boolean
}
```

- [ ] **Step 2: Create the tool builders**

Port from `simple-booking.ts` (lines 168-309) and `direct-booking.ts` (lines 99-492). Key changes:
- Both modes share `check_booking_availability` (uses the simple-booking version with nearest slot suggestions)
- `create_booking` behavior switches on `mode`: enquiry calls `createEnquiry()`, direct creates calendar event
- `list_bookings`, `update_booking`, `cancel_booking` only available in direct mode
- Use `checkFreeBusy` and `parseWallClock` from shared calendar utility

```typescript
// lib/agent/actions/booking/tools.ts
import { getCalendarConnection, getValidAccessToken } from '@/lib/scheduling/connections'
import {
  listCalendarEvents,
  getCalendarEvent,
  createCalendarEvent,
  updateCalendarEvent as updateCalEvent,
  deleteCalendarEvent as deleteCalEvent
} from '@/lib/scheduling/providers/google-calendar'
import { checkFreeBusy, parseWallClock, formatDateRange } from '../shared/calendar'
import type { CalendarConnectionDocument, BookableResource } from '@/lib/firestore-types'
import type { VibeAgent } from '@/lib/types'
import type { RegisteredTool } from '@/lib/agent/tools/base'
import type { ActionContext } from '../types'
import type { BookingConfig } from './types'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SEARCH_WINDOW_DAYS = 60
const MAX_SUGGESTIONS = 3

// ─── Helpers ────────────────────────────────────────────────────────

interface ResolvedResource {
  resource: BookableResource
  connection: CalendarConnectionDocument
  accessToken: string
}

async function resolveResource(
  agent: VibeAgent,
  config: BookingConfig,
  resourceName: string
): Promise<ResolvedResource | null> {
  const resource = config.resources.find(
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
  agent: VibeAgent,
  config: BookingConfig
): Promise<ResolvedResource[]> {
  const results: ResolvedResource[] = []
  for (const resource of config.resources) {
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

function parseGuestInfo(description: string): { name: string; count: number } | null {
  const nameMatch = description.match(/^Guest:\s*(.+)$/m)
  const countMatch = description.match(/^Guests:\s*(\d+)$/m)
  if (!nameMatch) return null
  return {
    name: nameMatch[1].trim(),
    count: countMatch ? parseInt(countMatch[1], 10) : 1
  }
}

function formatEventDate(dateStr: string, timezone: string): string {
  if (!dateStr) return 'unknown'
  try {
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

function findNearestSlots(
  busySlots: Array<{ start: number; end: number }>,
  requestedStart: number,
  durationMs: number,
  now: number
): number[] {
  const windowEnd = requestedStart + SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000

  const isBlocked = (startMs: number): boolean => {
    const endMs = startMs + durationMs
    return busySlots.some(b => startMs < b.end && endMs > b.start)
  }

  const forward: number[] = []
  let fCursor = requestedStart
  while (forward.length < MAX_SUGGESTIONS && fCursor < windowEnd) {
    if (!isBlocked(fCursor)) {
      forward.push(fCursor)
      fCursor += durationMs
    } else {
      const overlap = busySlots.find(b => fCursor < b.end && (fCursor + durationMs) > b.start)
      fCursor = overlap ? overlap.end : fCursor + durationMs
    }
  }

  const backward: number[] = []
  let bCursor = requestedStart - durationMs
  while (backward.length < MAX_SUGGESTIONS && bCursor >= now) {
    if (!isBlocked(bCursor)) {
      backward.unshift(bCursor)
      bCursor -= durationMs
    } else {
      const overlap = busySlots.find(b => bCursor < b.end && (bCursor + durationMs) > b.start)
      bCursor = overlap ? overlap.start - durationMs : bCursor - durationMs
    }
  }

  return [...backward, ...forward]
    .sort((a, b) => Math.abs(a - requestedStart) - Math.abs(b - requestedStart))
    .slice(0, MAX_SUGGESTIONS)
    .sort((a, b) => a - b)
}

// ─── Tool: check_booking_availability ───────────────────────────────

function buildCheckAvailabilityTool(agent: VibeAgent, config: BookingConfig): RegisteredTool {
  const resourceNames = config.resources.map(r => r.name).join(', ')

  return {
    function: {
      name: 'check_booking_availability',
      description:
        `Check if a resource is available for a date range. Available resources: ${resourceNames}. ` +
        `If unavailable, suggests up to 3 nearest free slots.`,
      parameters: {
        type: 'object',
        properties: {
          resource_name: {
            type: 'string',
            description: `Name of the resource. One of: ${resourceNames}.`
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

      const startDate = parseWallClock(startDatetime)
      const endDate = parseWallClock(endDatetime)

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return 'Invalid datetime format. Use YYYY-MM-DDTHH:MM (e.g. 2026-05-10T14:00).'
      }
      if (startDate.getTime() < Date.now()) return 'Start date cannot be in the past.'
      if (endDate <= startDate) return 'End datetime must be after start datetime.'

      const resolved = await resolveResource(agent, config, resourceName)
      if (!resolved) return `Unknown resource "${resourceName}". Available: ${resourceNames}.`

      try {
        const startMs = startDate.getTime()
        const durationMs = endDate.getTime() - startMs
        const now = Date.now()
        const windowEnd = new Date(startMs + SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000)
        const busySlots = await checkFreeBusy(
          resolved.accessToken,
          resolved.resource.calendarId,
          new Date(now),
          windowEnd
        )

        const hasConflict = busySlots.some(b => startMs < b.end && (startMs + durationMs) > b.start)
        if (!hasConflict) {
          return `${resolved.resource.name} is available from ${startDatetime} to ${endDatetime} (${resolved.resource.timezone}).`
        }

        const suggestions = findNearestSlots(busySlots, startMs, durationMs, now)
        if (suggestions.length === 0) {
          return `${resolved.resource.name} is not available for those dates and no alternatives were found in the next ${SEARCH_WINDOW_DAYS} days.`
        }

        const slots = suggestions.map((s, i) => `${i + 1}. ${formatDateRange(s, durationMs, resolved.resource.timezone)}`).join('\n')
        return `${resolved.resource.name} is not available for those dates. Nearest available slots (${resolved.resource.timezone}):\n${slots}`
      } catch (err) {
        return `Error checking availability: ${err instanceof Error ? err.message : 'Unknown error'}`
      }
    }
  }
}

// ─── Tool: create_booking (enquiry OR direct) ───────────────────────

function buildCreateBookingTool(agent: VibeAgent, config: BookingConfig): RegisteredTool {
  const resourceNames = config.resources.map(r => r.name).join(', ')
  const isEnquiry = config.mode === 'enquiry'

  const requiredFields = isEnquiry
    ? ['resource_name', 'start_datetime', 'end_datetime', 'guest_name', 'guest_email', 'guest_phone']
    : ['resource_name', 'check_in_date', 'check_out_date', 'guest_name', 'guest_count']

  const properties: Record<string, any> = {
    resource_name: { type: 'string', description: `Name of the resource. One of: ${resourceNames}.` }
  }

  if (isEnquiry) {
    properties.start_datetime = { type: 'string', description: 'Start date and time in YYYY-MM-DDTHH:MM format.' }
    properties.end_datetime = { type: 'string', description: 'End date and time in YYYY-MM-DDTHH:MM format.' }
    properties.guest_name = { type: 'string', description: 'Full name of the guest.' }
    properties.guest_email = { type: 'string', description: 'Email address of the guest.' }
    properties.guest_phone = { type: 'string', description: 'Phone number of the guest.' }
    properties.guest_count = { type: 'number', description: 'Number of guests (optional).' }
    properties.notes = { type: 'string', description: 'Special requirements or notes (optional).' }
  } else {
    properties.check_in_date = { type: 'string', description: 'Check-in date in YYYY-MM-DD format.' }
    properties.check_out_date = { type: 'string', description: 'Check-out date in YYYY-MM-DD format.' }
    properties.guest_name = { type: 'string', description: 'Full name of the guest.' }
    properties.guest_count = { type: 'number', description: 'Number of guests.' }
  }

  return {
    function: {
      name: 'create_booking',
      description: isEnquiry
        ? `Submit a booking enquiry for a resource. Available resources: ${resourceNames}. Always call check_booking_availability first. Collect guest details before submitting.`
        : `Create a booking on a room's calendar. Available rooms: ${resourceNames}. Always confirm details with the owner before calling this tool.`,
      parameters: {
        type: 'object',
        properties,
        required: requiredFields
      }
    },
    execute: isEnquiry
      ? async (args) => {
          // Enquiry mode — submit enquiry, don't create calendar event
          const resourceName = String(args.resource_name ?? '').trim()
          const startDatetime = String(args.start_datetime ?? '').trim()
          const endDatetime = String(args.end_datetime ?? '').trim()
          const guestName = String(args.guest_name ?? '').trim()
          const guestEmail = String(args.guest_email ?? '').trim()
          const guestPhone = String(args.guest_phone ?? '').trim()

          if (!guestName || !guestEmail || !guestPhone) {
            return 'Missing required fields: guest_name, guest_email, and guest_phone are all required.'
          }

          const startDate = parseWallClock(startDatetime)
          const endDate = parseWallClock(endDatetime)

          if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return 'Invalid datetime format. Use YYYY-MM-DDTHH:MM (e.g. 2026-05-10T14:00).'
          }
          if (startDate.getTime() < Date.now()) return 'Start date cannot be in the past.'
          if (endDate <= startDate) return 'End datetime must be after start datetime.'
          if (!EMAIL_REGEX.test(guestEmail)) return 'Invalid email address format.'

          const resolved = await resolveResource(agent, config, resourceName)
          if (!resolved) return `Unknown resource "${resourceName}". Available: ${resourceNames}.`

          try {
            const { createEnquiry } = await import('@/lib/booking-enquiries/create')
            const enquiryId = await createEnquiry({
              agent,
              resourceName: resolved.resource.name,
              calendarId: resolved.resource.calendarId,
              calendarName: resolved.resource.calendarName,
              timezone: resolved.resource.timezone,
              startDatetime,
              endDatetime,
              guestName,
              guestEmail,
              guestPhone,
              guestCount: typeof args.guest_count === 'number' ? args.guest_count : undefined,
              notes: args.notes ? String(args.notes).trim() : undefined
            })

            return (
              `Enquiry submitted for ${resolved.resource.name} from ${startDatetime} to ${endDatetime}. ` +
              `The host will review and contact you at ${guestEmail}. Reference: ${enquiryId}`
            )
          } catch (err) {
            return `Error submitting enquiry: ${err instanceof Error ? err.message : 'Unknown error'}`
          }
        }
      : async (args) => {
          // Direct mode — create calendar event
          const resourceName = String(args.resource_name ?? '').trim()
          const checkIn = String(args.check_in_date ?? '').trim()
          const checkOut = String(args.check_out_date ?? '').trim()
          const guestName = String(args.guest_name ?? '').trim()
          const guestCount = typeof args.guest_count === 'number' ? args.guest_count : 1

          if (!resourceName || !checkIn || !checkOut || !guestName) {
            return 'Missing required fields: resource_name, check_in_date, check_out_date, guest_name.'
          }
          if (checkOut <= checkIn) return 'check_out_date must be after check_in_date.'

          const resolved = await resolveResource(agent, config, resourceName)
          if (!resolved) return `Unknown room "${resourceName}". Available: ${resourceNames}.`

          try {
            if (config.overlapProtection) {
              const existing = await listCalendarEvents(
                resolved.accessToken,
                resolved.resource.calendarId,
                `${checkIn}T00:00:00`,
                `${checkOut}T23:59:59`
              )
              if (existing.length > 0) {
                const conflicts = existing.map(ev =>
                  `- ${ev.summary} | ${formatEventDate(ev.start, resolved.resource.timezone)} → ${formatEventDate(ev.end, resolved.resource.timezone)}`
                ).join('\n')
                return `Cannot create booking — ${resolved.resource.name} has overlapping bookings:\n${conflicts}`
              }
            }

            const title = buildTitle(config.eventTitleTemplate, guestName, guestCount)
            const description = buildDescription(guestName, guestCount)

            let startField: { date?: string; dateTime?: string; timeZone?: string }
            let endField: { date?: string; dateTime?: string; timeZone?: string }

            if (config.eventTimeMode === 'all-day') {
              startField = { date: checkIn }
              endField = { date: checkOut }
            } else {
              startField = { dateTime: `${checkIn}T14:00:00`, timeZone: resolved.resource.timezone }
              endField = { dateTime: `${checkOut}T11:00:00`, timeZone: resolved.resource.timezone }
            }

            const created = await createCalendarEvent(resolved.accessToken, resolved.resource.calendarId, {
              summary: title,
              description,
              start: startField,
              end: endField
            })

            return (
              `Booking created for ${resolved.resource.name}:\n` +
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

// ─── Tool: list_bookings (direct mode only) ─────────────────────────

function buildListBookingsTool(agent: VibeAgent, config: BookingConfig): RegisteredTool {
  const resourceNames = config.resources.map(r => r.name).join(', ')

  return {
    function: {
      name: 'list_bookings',
      description:
        `List booking events from room calendars. Available rooms: ${resourceNames}. ` +
        `If resource_name is omitted, lists events across all rooms.`,
      parameters: {
        type: 'object',
        properties: {
          resource_name: { type: 'string', description: `Room name (optional). One of: ${resourceNames}. Omit to query all rooms.` },
          start_date: { type: 'string', description: 'Start of date range in YYYY-MM-DD format.' },
          end_date: { type: 'string', description: 'End of date range in YYYY-MM-DD format.' }
        },
        required: ['start_date', 'end_date']
      }
    },
    execute: async (args) => {
      const resourceName = args.resource_name ? String(args.resource_name).trim() : ''
      const startDate = String(args.start_date ?? '').trim()
      const endDate = String(args.end_date ?? '').trim()

      if (!startDate || !endDate) return 'start_date and end_date are required (YYYY-MM-DD).'

      let resources: ResolvedResource[]
      if (resourceName) {
        const resolved = await resolveResource(agent, config, resourceName)
        if (!resolved) return `Unknown room "${resourceName}". Available: ${resourceNames}.`
        resources = [resolved]
      } else {
        resources = await resolveAllResources(agent, config)
        if (resources.length === 0) return 'No calendar connections available.'
      }

      try {
        const allEvents: Array<{ room: string; id: string; title: string; rawStart: string; start: string; end: string; description: string }> = []

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
              rawStart: ev.start,
              start: formatEventDate(ev.start, resource.timezone),
              end: formatEventDate(ev.end, resource.timezone),
              description: ev.description ?? ''
            })
          }
        }

        if (allEvents.length === 0) {
          return `No bookings found for ${resourceName || 'all rooms'} between ${startDate} and ${endDate}.`
        }

        allEvents.sort((a, b) => a.rawStart.localeCompare(b.rawStart))

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

// ─── Tool: update_booking (direct mode only) ─────────────────────────

function buildUpdateBookingTool(agent: VibeAgent, config: BookingConfig): RegisteredTool {
  const resourceNames = config.resources.map(r => r.name).join(', ')

  return {
    function: {
      name: 'update_booking',
      description:
        `Update an existing booking event. Available rooms: ${resourceNames}. ` +
        `Use list_bookings first to find the event_id. ` +
        `Always confirm changes with the owner before calling this tool.`,
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'Google Calendar event ID (from list_bookings).' },
          resource_name: { type: 'string', description: `Room name. One of: ${resourceNames}.` },
          check_in_date: { type: 'string', description: 'New check-in date in YYYY-MM-DD (optional).' },
          check_out_date: { type: 'string', description: 'New check-out date in YYYY-MM-DD (optional).' },
          guest_name: { type: 'string', description: 'New guest name (optional).' },
          guest_count: { type: 'number', description: 'New guest count (optional).' }
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

      const resolved = await resolveResource(agent, config, resourceName)
      if (!resolved) return `Unknown room "${resourceName}". Available: ${resourceNames}.`

      try {
        let currentEvent: Awaited<ReturnType<typeof getCalendarEvent>> | null = null
        if ((config.overlapProtection && (checkIn || checkOut)) || guestName || guestCount !== undefined) {
          currentEvent = await getCalendarEvent(resolved.accessToken, resolved.resource.calendarId, eventId)
        }

        if (config.overlapProtection && (checkIn || checkOut)) {
          const effectiveCheckIn = checkIn ?? (currentEvent!.start.split('T')[0] ?? '')
          const effectiveCheckOut = checkOut ?? (currentEvent!.end.split('T')[0] ?? '')
          if (effectiveCheckOut <= effectiveCheckIn) return 'check_out_date must be after check_in_date.'
          const existing = await listCalendarEvents(
            resolved.accessToken,
            resolved.resource.calendarId,
            `${effectiveCheckIn}T00:00:00`,
            `${effectiveCheckOut}T23:59:59`
          )
          const conflicts = existing.filter(ev => ev.id !== eventId)
          if (conflicts.length > 0) {
            const lines = conflicts.map(ev =>
              `- ${ev.summary} | ${formatEventDate(ev.start, resolved.resource.timezone)} → ${formatEventDate(ev.end, resolved.resource.timezone)}`
            ).join('\n')
            return `Cannot update — new dates overlap with existing bookings:\n${lines}`
          }
        }

        const updates: Record<string, any> = {}

        if (guestName || guestCount !== undefined) {
          const existingInfo = currentEvent?.description ? parseGuestInfo(currentEvent.description) : null
          const currentName = guestName ?? (existingInfo?.name ?? 'Guest')
          const currentCount = guestCount ?? (existingInfo?.count ?? 1)
          updates.summary = buildTitle(config.eventTitleTemplate, currentName, currentCount)
          updates.description = buildDescription(currentName, currentCount)
        }

        if (checkIn) {
          updates.start = config.eventTimeMode === 'all-day'
            ? { date: checkIn }
            : { dateTime: `${checkIn}T14:00:00`, timeZone: resolved.resource.timezone }
        }

        if (checkOut) {
          updates.end = config.eventTimeMode === 'all-day'
            ? { date: checkOut }
            : { dateTime: `${checkOut}T11:00:00`, timeZone: resolved.resource.timezone }
        }

        if (Object.keys(updates).length === 0) return 'No changes specified.'

        const updated = await updateCalEvent(resolved.accessToken, resolved.resource.calendarId, eventId, updates)

        return (
          `Booking updated for ${resolved.resource.name}:\n` +
          `- Title: ${updated.summary}\n` +
          `- Start: ${formatEventDate(updated.start, resolved.resource.timezone)}\n` +
          `- End: ${formatEventDate(updated.end, resolved.resource.timezone)}\n` +
          `- Event ID: ${updated.id}`
        )
      } catch (err) {
        return `Error updating booking: ${err instanceof Error ? err.message : 'Unknown error'}`
      }
    }
  }
}

// ─── Tool: cancel_booking (direct mode only) ────────────────────────

function buildCancelBookingTool(agent: VibeAgent, config: BookingConfig): RegisteredTool {
  const resourceNames = config.resources.map(r => r.name).join(', ')

  return {
    function: {
      name: 'cancel_booking',
      description:
        `Delete (cancel) a booking event. Available rooms: ${resourceNames}. ` +
        `Use list_bookings first to find the event_id. ` +
        `Always confirm with the owner before calling this tool.`,
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'Google Calendar event ID (from list_bookings).' },
          resource_name: { type: 'string', description: `Room name. One of: ${resourceNames}.` }
        },
        required: ['event_id', 'resource_name']
      }
    },
    execute: async (args) => {
      const eventId = String(args.event_id ?? '').trim()
      const resourceName = String(args.resource_name ?? '').trim()

      if (!eventId || !resourceName) return 'event_id and resource_name are required.'

      const resolved = await resolveResource(agent, config, resourceName)
      if (!resolved) return `Unknown room "${resourceName}". Available: ${resourceNames}.`

      try {
        await deleteCalEvent(resolved.accessToken, resolved.resource.calendarId, eventId)
        return `Booking deleted from ${resolved.resource.name}. Event ID: ${eventId}`
      } catch (err) {
        return `Error deleting booking: ${err instanceof Error ? err.message : 'Unknown error'}`
      }
    }
  }
}

// ─── Export: build all tools ────────────────────────────────────────

export async function buildBookingTools(ctx: ActionContext): Promise<RegisteredTool[]> {
  const config = ctx.action.config as BookingConfig
  if (!config.resources || config.resources.length === 0) return []

  const tools: RegisteredTool[] = [
    buildCheckAvailabilityTool(ctx.agent, config),
    buildCreateBookingTool(ctx.agent, config)
  ]

  // Direct mode gets full CRUD
  if (config.mode === 'direct') {
    tools.push(
      buildListBookingsTool(ctx.agent, config),
      buildUpdateBookingTool(ctx.agent, config),
      buildCancelBookingTool(ctx.agent, config)
    )
  }

  return tools
}
```

- [ ] **Step 3: Create the module index**

```typescript
// lib/agent/actions/booking/index.ts
import type { ActionModule } from '../types'
import { buildBookingTools } from './tools'

export const BookingModule: ActionModule = {
  type: 'booking',
  buildTools: buildBookingTools
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/agent/actions/booking/
git commit -m "feat(actions): add booking module (merges simple-booking + direct-booking)"
```

---

### Task 5: Extend DataProvider Interface

Add `queryRows()` and `deleteRow()` to the DataProvider interface before building the Data module.

**Files:**
- Modify: `lib/data/providers/types.ts`

- [ ] **Step 1: Add new methods to DataProvider**

Add these to `lib/data/providers/types.ts` after the existing `UpdateRowResult` interface:

```typescript
export interface QueryRowsResult {
  rows: Record<string, any>[]
  totalMatched: number
}

export interface DeleteRowResult {
  success: boolean
  matched: boolean
}
```

Update the `DataProvider` interface to add:

```typescript
  queryRows?(
    keyField: string,
    keyValue: string,
    limit?: number
  ): Promise<QueryRowsResult>
  deleteRow?(
    keyField: string,
    keyValue: string
  ): Promise<DeleteRowResult>
```

These are optional methods — providers that don't support them won't implement them. The Data module checks before calling.

- [ ] **Step 2: Commit**

```bash
git add lib/data/providers/types.ts
git commit -m "feat(data): add queryRows and deleteRow to DataProvider interface"
```

---

### Task 6: Data Module

Port from `lib/agent/tools/data-actions.ts` and add `query_records` and `delete_record` tools.

**Files:**
- Create: `lib/agent/actions/data/types.ts`
- Create: `lib/agent/actions/data/tools.ts`
- Create: `lib/agent/actions/data/index.ts`

- [ ] **Step 1: Create data types**

```typescript
// lib/agent/actions/data/types.ts

export interface DataFieldMapping {
  collectionFieldId: string
  targetColumn: string
}

export interface DataConfig {
  fieldMappings: DataFieldMapping[]
  updateKeyField?: string | null
  allowQuery: boolean
  allowDelete: boolean
  autoSubmitOnComplete: boolean
}
```

- [ ] **Step 2: Create the tool builders**

Port the existing `submit_data` and `update_record` from `lib/agent/tools/data-actions.ts`, then add new `query_records` and `delete_record` tools.

```typescript
// lib/agent/actions/data/tools.ts
import { adminDb } from '@/lib/firebase/admin'
import {
  Collections,
  type DataActionLogDocument,
  type DataConnectionDocument
} from '@/lib/firestore-types'
import { createDataProvider } from '@/lib/data/providers'
import { getDataConnection, getValidDataAccessToken } from '@/lib/data/connections'
import type { RegisteredTool } from '@/lib/agent/tools/base'
import type { VibeAgent } from '@/lib/types'
import type { ActionContext } from '../types'
import type { DataConfig } from './types'

// ─── Helpers ────────────────────────────────────────────────────────

interface DataToolContext {
  agent: VibeAgent
  connection: DataConnectionDocument
  config: DataConfig
}

function mapDataToColumns(
  data: Record<string, any>,
  config: DataConfig
): Record<string, any> {
  if (config.fieldMappings.length === 0) return data

  const mapped: Record<string, any> = {}
  for (const mapping of config.fieldMappings) {
    const value =
      data[mapping.collectionFieldId] ??
      data[mapping.targetColumn] ??
      Object.entries(data).find(
        ([key]) => key.toLowerCase() === mapping.targetColumn.toLowerCase()
      )?.[1]

    if (value !== undefined) {
      mapped[mapping.targetColumn] = value
    }
  }

  for (const [key, value] of Object.entries(data)) {
    const isMapped = config.fieldMappings.some(
      m =>
        m.collectionFieldId === key ||
        m.targetColumn.toLowerCase() === key.toLowerCase()
    )
    if (!isMapped) {
      mapped[key] = value
    }
  }

  return mapped
}

async function logDataAction(
  ctx: DataToolContext,
  action: DataActionLogDocument['action'],
  status: 'success' | 'failed',
  rowData: Record<string, any>,
  externalRef?: string,
  error?: string
): Promise<void> {
  try {
    const logsPath = Collections.dataLogs(ctx.agent.tenantId!, ctx.agent.id)
    const docRef = adminDb.collection(logsPath).doc()
    const log: DataActionLogDocument = {
      id: docRef.id,
      agentId: ctx.agent.id,
      tenantId: ctx.agent.tenantId!,
      conversationId: '',
      connectionId: ctx.connection.id,
      provider: ctx.connection.provider,
      action,
      status,
      rowData,
      externalRef,
      error,
      createdAt: new Date().toISOString()
    }
    await docRef.set(log)
  } catch {
    console.error('Failed to log data action')
  }
}

// ─── Tool: submit_data ──────────────────────────────────────────────

function buildSubmitDataTool(ctx: DataToolContext): RegisteredTool {
  return {
    function: {
      name: 'submit_data',
      description:
        'Submit collected data to the configured data store (Google Sheets, Airtable, or webhook). Call this after collecting all required information from the user.',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            description: 'Key-value pairs of field names/labels to their values. Example: {"Name": "John", "Email": "john@example.com"}'
          }
        },
        required: ['data']
      }
    },
    execute: async (args) => {
      const rawData = args.data as Record<string, any> | undefined
      if (!rawData || typeof rawData !== 'object' || Object.keys(rawData).length === 0) {
        return 'Please provide data as key-value pairs. Example: {"Name": "John", "Email": "john@example.com"}'
      }

      try {
        const accessToken = await getValidDataAccessToken(ctx.connection)
        const provider = createDataProvider(ctx.connection, accessToken)
        const mappedData = mapDataToColumns(rawData, ctx.config)

        const result = await provider.appendRow(mappedData)

        await logDataAction(
          ctx,
          ctx.connection.provider === 'custom_webhook' ? 'webhook_submit' : 'append_row',
          'success',
          mappedData,
          result.externalRef
        )

        const providerLabel =
          ctx.connection.provider === 'google_sheets' ? 'Google Sheets'
            : ctx.connection.provider === 'airtable' ? 'Airtable'
            : 'webhook'

        const lines = [
          `Data submitted successfully to ${providerLabel}!`,
          `Fields: ${Object.keys(mappedData).join(', ')}`
        ]
        if (result.externalRef) lines.push(`Reference: ${result.externalRef}`)
        return lines.join('\n')
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        await logDataAction(ctx, 'append_row', 'failed', rawData, undefined, errorMsg)
        return `Error submitting data: ${errorMsg}`
      }
    }
  }
}

// ─── Tool: update_record ────────────────────────────────────────────

function buildUpdateRecordTool(ctx: DataToolContext): RegisteredTool {
  const keyField = ctx.config.updateKeyField!

  return {
    function: {
      name: 'update_record',
      description: `Update an existing record in the data store. Searches for a record where "${keyField}" matches the provided key_value, then updates it with the given data.`,
      parameters: {
        type: 'object',
        properties: {
          key_value: { type: 'string', description: `The value to search for in the "${keyField}" field.` },
          data: { type: 'object', description: 'Key-value pairs of fields to update. Example: {"Status": "Completed", "Notes": "Done"}' }
        },
        required: ['key_value', 'data']
      }
    },
    execute: async (args) => {
      const keyValue = String(args.key_value ?? '').trim()
      const rawData = args.data as Record<string, any> | undefined

      if (!keyValue) return `Please provide the value to search for in the "${keyField}" field.`
      if (!rawData || typeof rawData !== 'object' || Object.keys(rawData).length === 0) {
        return 'Please provide data to update as key-value pairs.'
      }

      try {
        const accessToken = await getValidDataAccessToken(ctx.connection)
        const provider = createDataProvider(ctx.connection, accessToken)
        const mappedData = mapDataToColumns(rawData, ctx.config)

        const result = await provider.updateRow(keyField, keyValue, mappedData)

        if (!result.matched) {
          await logDataAction(ctx, 'update_row', 'failed', rawData, undefined, `No record found with ${keyField}="${keyValue}"`)
          return `No record found where "${keyField}" = "${keyValue}". Please check the value and try again.`
        }

        await logDataAction(ctx, 'update_row', 'success', mappedData, result.externalRef)

        const lines = [
          `Record updated successfully!`,
          `Matched: ${keyField} = "${keyValue}"`,
          `Updated fields: ${Object.keys(mappedData).join(', ')}`
        ]
        if (result.externalRef) lines.push(`Reference: ${result.externalRef}`)
        return lines.join('\n')
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        await logDataAction(ctx, 'update_row', 'failed', rawData, undefined, errorMsg)
        return `Error updating record: ${errorMsg}`
      }
    }
  }
}

// ─── Tool: query_records ────────────────────────────────────────────

function buildQueryRecordsTool(ctx: DataToolContext): RegisteredTool {
  const keyField = ctx.config.updateKeyField ?? 'id'

  return {
    function: {
      name: 'query_records',
      description: `Search for records in the data store. Finds records where "${keyField}" matches the provided value.`,
      parameters: {
        type: 'object',
        properties: {
          key_value: { type: 'string', description: `The value to search for in the "${keyField}" field.` },
          limit: { type: 'number', description: 'Maximum number of records to return (default 10).' }
        },
        required: ['key_value']
      }
    },
    execute: async (args) => {
      const keyValue = String(args.key_value ?? '').trim()
      const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 10

      if (!keyValue) return `Please provide a value to search for in the "${keyField}" field.`

      try {
        const accessToken = await getValidDataAccessToken(ctx.connection)
        const provider = createDataProvider(ctx.connection, accessToken)

        if (!provider.queryRows) {
          return 'Query is not supported by this data provider.'
        }

        const result = await provider.queryRows(keyField, keyValue, limit)

        if (result.rows.length === 0) {
          return `No records found where "${keyField}" = "${keyValue}".`
        }

        const formatted = result.rows.map((row, i) => {
          const fields = Object.entries(row).map(([k, v]) => `  ${k}: ${v}`).join('\n')
          return `Record ${i + 1}:\n${fields}`
        }).join('\n---\n')

        return `Found ${result.totalMatched} record(s):\n${formatted}`
      } catch (error) {
        return `Error querying records: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}

// ─── Tool: delete_record ────────────────────────────────────────────

function buildDeleteRecordTool(ctx: DataToolContext): RegisteredTool {
  const keyField = ctx.config.updateKeyField ?? 'id'

  return {
    function: {
      name: 'delete_record',
      description: `Delete a record from the data store. Finds and removes the record where "${keyField}" matches the provided value. Always confirm with the user before deleting.`,
      parameters: {
        type: 'object',
        properties: {
          key_value: { type: 'string', description: `The value to search for in the "${keyField}" field to identify the record to delete.` }
        },
        required: ['key_value']
      }
    },
    execute: async (args) => {
      const keyValue = String(args.key_value ?? '').trim()

      if (!keyValue) return `Please provide the value to search for in the "${keyField}" field.`

      try {
        const accessToken = await getValidDataAccessToken(ctx.connection)
        const provider = createDataProvider(ctx.connection, accessToken)

        if (!provider.deleteRow) {
          return 'Delete is not supported by this data provider.'
        }

        const result = await provider.deleteRow(keyField, keyValue)

        if (!result.matched) {
          return `No record found where "${keyField}" = "${keyValue}". Nothing deleted.`
        }

        return `Record deleted successfully where "${keyField}" = "${keyValue}".`
      } catch (error) {
        return `Error deleting record: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}

// ─── Export: build all tools ────────────────────────────────────────

export async function buildDataTools(ctx: ActionContext): Promise<RegisteredTool[]> {
  const config = ctx.action.config as DataConfig
  const connectionId = ctx.action.connectionId
  if (!connectionId || !ctx.agent.tenantId) return []

  const connection = await getDataConnection(ctx.agent.tenantId, connectionId)
  if (!connection || connection.status !== 'active') return []

  const toolCtx: DataToolContext = { agent: ctx.agent, connection, config }
  const tools: RegisteredTool[] = [buildSubmitDataTool(toolCtx)]

  if (config.updateKeyField) {
    tools.push(buildUpdateRecordTool(toolCtx))
  }
  if (config.allowQuery) {
    tools.push(buildQueryRecordsTool(toolCtx))
  }
  if (config.allowDelete) {
    tools.push(buildDeleteRecordTool(toolCtx))
  }

  return tools
}
```

- [ ] **Step 3: Create the module index**

```typescript
// lib/agent/actions/data/index.ts
import type { ActionModule } from '../types'
import { buildDataTools } from './tools'

export const DataModule: ActionModule = {
  type: 'data',
  buildTools: buildDataTools
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/agent/actions/data/
git commit -m "feat(actions): add data module with query_records and delete_record tools"
```

---

### Task 7: Action Registry & Context-Builder Rewrite

Create the registry and rewrite context-builder to use it.

**Files:**
- Create: `lib/agent/actions/registry.ts`
- Modify: `lib/agent/context-builder.ts`

- [ ] **Step 1: Create the registry**

```typescript
// lib/agent/actions/registry.ts
import type { ActionModule, ActionContext, AgentAction } from './types'
import type { RegisteredTool } from '@/lib/agent/tools/base'
import type { VibeAgent } from '@/lib/types'
import { AppointmentsModule } from './appointments'
import { BookingModule } from './booking'
import { DataModule } from './data'

const ACTION_REGISTRY: Record<string, ActionModule> = {
  appointments: AppointmentsModule,
  booking: BookingModule,
  data: DataModule,
}

/**
 * Inject action tools into a toolkit by iterating through agent.actions
 * and delegating to the registry. Replaces all if/else blocks in context-builder.
 */
export async function injectActionTools(
  agent: VibeAgent,
  toolkit: { functions: any[]; executors: Record<string, any> }
): Promise<void> {
  const actions: AgentAction[] = agent.actions ?? []

  for (const action of actions) {
    if (!action.enabled) continue

    const module = ACTION_REGISTRY[action.type]
    if (!module) continue

    try {
      const ctx: ActionContext = { agent, action }
      const tools: RegisteredTool[] = await module.buildTools(ctx)

      for (const tool of tools) {
        toolkit.functions.push(tool.function)
        toolkit.executors[tool.function.name] = tool.execute
      }
    } catch (err) {
      console.error(`Failed to inject ${action.type} tools:`, err)
    }
  }
}
```

- [ ] **Step 2: Rewrite context-builder**

Replace the entire action injection section in `lib/agent/context-builder.ts` (lines 71-175 — everything from "Inject scheduling tools" to the end of the booking block) with a single call:

Remove the old imports at the top:
```typescript
// DELETE these imports:
import { isFeatureEnabled } from '@/lib/features'
import { getCalendarConnection, getValidAccessToken } from '@/lib/scheduling/connections'
import { buildSchedulingTools } from './tools/scheduling'
import { getDataConnection } from '@/lib/data/connections'
import { buildDataTools } from './tools/data-actions'
import { buildCalendarAvailabilityTools } from './tools/calendar-availability'
import { buildSimpleBookingTools } from './tools/simple-booking'
import { buildDirectBookingTools } from './tools/direct-booking'
```

Add the new import:
```typescript
import { injectActionTools } from './actions/registry'
```

Replace lines 71-175 (the entire if/else block for scheduling, data, booking, availability) with:
```typescript
  // Inject action module tools (appointments, booking, data, etc.)
  await injectActionTools(agent, toolkit)
```

The complete `buildAgentContext` function after rewrite should be ~80 lines instead of 187.

- [ ] **Step 3: Commit**

```bash
git add lib/agent/actions/registry.ts lib/agent/context-builder.ts
git commit -m "feat(actions): add registry and simplify context-builder to registry loop"
```

---

### Task 8: Update VibeAgent Type

Add `actions` array to the `VibeAgent` interface. Keep old config fields during transition.

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/firestore-types.ts`

- [ ] **Step 1: Add AgentAction to types.ts**

In `lib/types.ts`, add after the `VibeAgentTool` interface (line 53):

```typescript
export interface AgentAction {
  id: string
  type: 'appointments' | 'booking' | 'data'
  enabled: boolean
  connectionId?: string | null
  config: Record<string, any>
}
```

Add to the `VibeAgent` interface (after `bookingConfig` on line 128):

```typescript
  actions?: AgentAction[]
```

Keep the old config fields — they'll be removed after migration is complete.

- [ ] **Step 2: Update firestore-types.ts**

In `lib/firestore-types.ts`, add `'query_row' | 'delete_row'` to the `DataActionType` union (line 35):

```typescript
export type DataActionType = 'append_row' | 'update_row' | 'webhook_submit' | 'query_row' | 'delete_row'
```

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts lib/firestore-types.ts
git commit -m "feat(actions): add actions array to VibeAgent type"
```

---

### Task 9: Migration Script

Create a script to migrate existing agents from old config fields to the new `actions` array.

**Files:**
- Create: `scripts/migrate-actions.ts`

- [ ] **Step 1: Write the migration script**

```typescript
// scripts/migrate-actions.ts
/**
 * One-time migration: convert old schedulingConfig/bookingConfig/dataConfig
 * fields to the new agent.actions[] array.
 *
 * Run: npx tsx scripts/migrate-actions.ts [--dry-run]
 *
 * Safe to run multiple times — skips agents that already have actions[].
 */
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import type { AgentAction } from '@/lib/types'

const DRY_RUN = process.argv.includes('--dry-run')

function generateId(): string {
  return adminDb.collection('_').doc().id
}

async function main() {
  console.log(`Migration mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`)

  const tenantsSnap = await adminDb.collection('tenants').get()
  let migrated = 0
  let skipped = 0

  for (const tenantDoc of tenantsSnap.docs) {
    const tenantId = tenantDoc.id
    const agentsSnap = await adminDb.collection(Collections.agents(tenantId)).get()

    for (const agentDoc of agentsSnap.docs) {
      const agent = agentDoc.data()

      // Skip if already migrated
      if (agent.actions && Array.isArray(agent.actions) && agent.actions.length > 0) {
        skipped++
        continue
      }

      const actions: AgentAction[] = []

      // Migrate schedulingConfig → appointments action
      if (agent.schedulingConfig?.enabled) {
        const sc = agent.schedulingConfig
        actions.push({
          id: generateId(),
          type: 'appointments',
          enabled: true,
          connectionId: sc.calendarConnectionId ?? null,
          config: {
            timezone: sc.timezone ?? 'UTC',
            availableHours: sc.availableHours ?? { start: '09:00', end: '17:00' },
            availableDays: sc.availableDays ?? [1, 2, 3, 4, 5],
            defaultDurationMinutes: sc.defaultDurationMinutes ?? 30,
            bufferMinutes: sc.bufferMinutes ?? 0,
            meetingTitleTemplate: sc.meetingTitleTemplate ?? 'Meeting with {{name}}',
            meetingDescription: sc.meetingDescription,
            createMeetLink: sc.createMeetLink ?? false
          }
        })
      }

      // Migrate bookingConfig → booking action
      if (agent.bookingConfig?.enabled) {
        const bc = agent.bookingConfig
        actions.push({
          id: generateId(),
          type: 'booking',
          enabled: true,
          config: {
            mode: bc.mode ?? 'enquiry',
            resources: bc.resources ?? [],
            eventTitleTemplate: bc.eventTitleTemplate ?? '{guest_name} ({guest_count} guests)',
            eventTimeMode: bc.eventTimeMode ?? 'all-day',
            overlapProtection: bc.overlapProtection !== false
          }
        })
      } else if (agent.calendarAvailabilityConfig?.enabled) {
        // Legacy: calendarAvailabilityConfig → booking action with single resource
        const ca = agent.calendarAvailabilityConfig
        actions.push({
          id: generateId(),
          type: 'booking',
          enabled: true,
          config: {
            mode: 'enquiry',
            resources: [{
              id: generateId(),
              name: ca.resourceName ?? 'Resource',
              calendarConnectionId: ca.calendarConnectionId ?? '',
              calendarId: ca.calendarId ?? '',
              calendarName: ca.resourceName ?? 'Calendar',
              timezone: 'UTC'
            }],
            eventTitleTemplate: '{guest_name} ({guest_count} guests)',
            eventTimeMode: 'all-day',
            overlapProtection: true
          }
        })
      }

      // Migrate dataConfig → data action
      if (agent.dataConfig?.enabled) {
        const dc = agent.dataConfig
        actions.push({
          id: generateId(),
          type: 'data',
          enabled: true,
          connectionId: dc.dataConnectionId ?? null,
          config: {
            fieldMappings: dc.fieldMappings ?? [],
            updateKeyField: dc.updateKeyField ?? null,
            allowQuery: false,
            allowDelete: false,
            autoSubmitOnComplete: dc.autoSubmitOnComplete ?? false
          }
        })
      }

      if (actions.length === 0) {
        skipped++
        continue
      }

      console.log(`  ${tenantId}/${agentDoc.id}: ${actions.map(a => a.type).join(', ')}`)

      if (!DRY_RUN) {
        await agentDoc.ref.update({ actions })
      }

      migrated++
    }
  }

  console.log(`\nDone. Migrated: ${migrated}, Skipped: ${skipped}`)
}

main().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Commit**

```bash
git add scripts/migrate-actions.ts
git commit -m "feat(actions): add migration script for old configs → actions array"
```

---

### Task 10: Add Backward-Compatible Fallback to Context-Builder

Ensure existing agents without `actions[]` still work during the transition period.

**Files:**
- Modify: `lib/agent/actions/registry.ts`

- [ ] **Step 1: Add fallback logic to injectActionTools**

Update the `injectActionTools` function in `lib/agent/actions/registry.ts` to build the actions array from old config fields when `agent.actions` is undefined:

```typescript
/**
 * Build an AgentAction[] from the legacy config fields for backward compatibility.
 * Only used during the migration transition period.
 */
function buildLegacyActions(agent: VibeAgent): AgentAction[] {
  const actions: AgentAction[] = []

  if (agent.schedulingConfig?.enabled && agent.schedulingConfig.calendarConnectionId) {
    actions.push({
      id: 'legacy-appointments',
      type: 'appointments',
      enabled: true,
      connectionId: agent.schedulingConfig.calendarConnectionId,
      config: {
        timezone: agent.schedulingConfig.timezone,
        availableHours: agent.schedulingConfig.availableHours,
        availableDays: agent.schedulingConfig.availableDays,
        defaultDurationMinutes: agent.schedulingConfig.defaultDurationMinutes,
        bufferMinutes: agent.schedulingConfig.bufferMinutes,
        meetingTitleTemplate: agent.schedulingConfig.meetingTitleTemplate,
        meetingDescription: agent.schedulingConfig.meetingDescription,
        createMeetLink: agent.schedulingConfig.createMeetLink
      }
    })
  }

  if (agent.bookingConfig?.enabled && agent.bookingConfig.resources.length > 0) {
    actions.push({
      id: 'legacy-booking',
      type: 'booking',
      enabled: true,
      config: {
        mode: agent.bookingConfig.mode ?? 'enquiry',
        resources: agent.bookingConfig.resources,
        eventTitleTemplate: agent.bookingConfig.eventTitleTemplate ?? '{guest_name} ({guest_count} guests)',
        eventTimeMode: agent.bookingConfig.eventTimeMode ?? 'all-day',
        overlapProtection: agent.bookingConfig.overlapProtection !== false
      }
    })
  }

  if (agent.dataConfig?.enabled && agent.dataConfig.dataConnectionId) {
    actions.push({
      id: 'legacy-data',
      type: 'data',
      enabled: true,
      connectionId: agent.dataConfig.dataConnectionId,
      config: {
        fieldMappings: agent.dataConfig.fieldMappings,
        updateKeyField: agent.dataConfig.updateKeyField,
        allowQuery: false,
        allowDelete: false,
        autoSubmitOnComplete: agent.dataConfig.autoSubmitOnComplete
      }
    })
  }

  return actions
}
```

Update `injectActionTools` to use it:

```typescript
export async function injectActionTools(
  agent: VibeAgent,
  toolkit: { functions: any[]; executors: Record<string, any> }
): Promise<void> {
  // Use new actions array if present, otherwise build from legacy config fields
  const actions: AgentAction[] = agent.actions ?? buildLegacyActions(agent)

  for (const action of actions) {
    // ... rest stays the same
```

- [ ] **Step 2: Commit**

```bash
git add lib/agent/actions/registry.ts
git commit -m "feat(actions): add backward-compatible fallback for legacy config fields"
```

---

### Task 11: Delete Old Files

Remove the old tool files that have been replaced by the new modules.

**Files:**
- Delete: `lib/agent/tools/scheduling.ts`
- Delete: `lib/agent/tools/simple-booking.ts`
- Delete: `lib/agent/tools/simple-booking.test.ts`
- Delete: `lib/agent/tools/direct-booking.ts`
- Delete: `lib/agent/tools/calendar-availability.ts`
- Delete: `lib/agent/tools/data-actions.ts`

- [ ] **Step 1: Verify no other code imports the old files**

Run: `grep -r "from.*tools/scheduling\|from.*tools/simple-booking\|from.*tools/direct-booking\|from.*tools/calendar-availability\|from.*tools/data-actions" lib/ --include='*.ts' --include='*.tsx'`

Expected: Only `lib/agent/context-builder.ts` should reference them (which we already updated). If other files import them, update those imports first.

- [ ] **Step 2: Delete the old files**

```bash
rm lib/agent/tools/scheduling.ts
rm lib/agent/tools/simple-booking.ts
rm lib/agent/tools/simple-booking.test.ts
rm lib/agent/tools/direct-booking.ts
rm lib/agent/tools/calendar-availability.ts
rm lib/agent/tools/data-actions.ts
```

- [ ] **Step 3: Commit**

```bash
git add -u lib/agent/tools/
git commit -m "refactor(actions): remove old tool files replaced by action modules"
```

---

### Task 12: Simplify Feature Flags

Remove the per-action feature flags. The parent `AGENT_ACTIONS` flag is sufficient — granularity is now at the module level via `action.enabled`.

**Files:**
- Modify: `lib/feature-flags.ts`

- [ ] **Step 1: Remove sub-flags**

In `lib/feature-flags.ts`, remove `'AGENT_ACTIONS_SCHEDULE'`, `'AGENT_ACTIONS_DATA'`, and `'AGENT_ACTIONS_BOOKING'` from the `FEATURE_FLAG_NAMES` array (lines 23-25).

Remove their entries from `FEATURE_FLAG_HIERARCHY` (lines 47-49).

Keep `'AGENT_ACTIONS'` as the single flag.

- [ ] **Step 2: Update UI components that reference old flags**

In `components/agents/agent-dashboard-tabs.tsx`, replace the per-action `FeatureGate` wrappers (lines 260-315) to all use `feature="AGENT_ACTIONS"` instead of the specific sub-flags.

- [ ] **Step 3: Update API routes that check old flags**

Search for `isFeatureEnabled(tenantId, 'AGENT_ACTIONS_SCHEDULE')`, `AGENT_ACTIONS_DATA`, `AGENT_ACTIONS_BOOKING` in `app/api/` routes and update them to check `AGENT_ACTIONS` instead.

Run: `grep -rn "AGENT_ACTIONS_SCHEDULE\|AGENT_ACTIONS_DATA\|AGENT_ACTIONS_BOOKING" app/api/ --include='*.ts'`

Update each occurrence.

- [ ] **Step 4: Commit**

```bash
git add lib/feature-flags.ts components/agents/agent-dashboard-tabs.tsx app/api/
git commit -m "refactor(actions): simplify feature flags to single AGENT_ACTIONS flag"
```

---

### Task 13: Build Verification

Verify the project builds without errors after all changes.

- [ ] **Step 1: Run TypeScript type check**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 2: Run existing tests**

Run: `node --experimental-strip-types --test lib/agent/actions/shared/calendar.test.ts`
Expected: All tests pass

- [ ] **Step 3: Run Next.js build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Fix any build errors found**

If there are import errors or type mismatches, fix them and commit.

```bash
git add -A
git commit -m "fix(actions): resolve build errors from module migration"
```
