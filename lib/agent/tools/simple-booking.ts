import { getCalendarConnection, getValidAccessToken } from '@/lib/scheduling/connections'
import { fetchWithRetry } from '@/lib/utils/fetch-with-retry'
import type { CalendarConnectionDocument, BookableResource } from '@/lib/firestore-types'
import type { VibeAgent } from '@/lib/types'
import type { RegisteredTool } from './base'

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SEARCH_WINDOW_DAYS = 60
const MAX_SUGGESTIONS = 3

// ─── Types ──────────────────────────────────────────────────────────

interface ResolvedResource {
  resource: BookableResource
  connection: CalendarConnectionDocument
  calendarId: string
  calendarName: string
  timezone: string
}

interface BusySlot {
  start: number
  end: number
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

  return {
    resource,
    connection,
    calendarId: resource.calendarId,
    calendarName: resource.calendarName,
    timezone: resource.timezone
  }
}

function parseWallClock(datetime: string): Date {
  // Treat wall-clock strings (no tz suffix) as UTC for freeBusy boundary purposes.
  // The resource timezone is declared separately via TZID in ICS — not used for API calls.
  const iso = datetime.includes('T') ? datetime : `${datetime}T00:00:00`
  return new Date(iso.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`)
}

function formatSlot(startMs: number, durationMs: number, timezone: string): string {
  const fmt = (ms: number) =>
    new Date(ms).toLocaleString('en-US', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  return `${fmt(startMs)} → ${fmt(startMs + durationMs)}`
}

async function fetchBusySlots(
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

function findNearestSlots(
  busySlots: BusySlot[],
  requestedStart: number,
  durationMs: number,
  now: number
): number[] {
  const windowEnd = requestedStart + SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000

  const isBlocked = (startMs: number): boolean => {
    const endMs = startMs + durationMs
    return busySlots.some(b => startMs < b.end && endMs > b.start)
  }

  // Scan forward
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

  // Scan backward — never before now
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

// ─── Availability check logic (extracted to keep execute CCN < 15) ──

async function queryAvailability(
  accessToken: string,
  ctx: ResolvedResource,
  startMs: number,
  durationMs: number,
  startDatetime: string,
  endDatetime: string
): Promise<string> {
  const now = Date.now()
  const windowEnd = new Date(startMs + SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const busySlots = await fetchBusySlots(accessToken, ctx.calendarId, new Date(now), windowEnd)

  const hasConflict = busySlots.some(b => startMs < b.end && (startMs + durationMs) > b.start)
  if (!hasConflict) {
    return `${ctx.resource.name} is available from ${startDatetime} to ${endDatetime} (${ctx.timezone}).`
  }

  const suggestions = findNearestSlots(busySlots, startMs, durationMs, now)
  if (suggestions.length === 0) {
    return `${ctx.resource.name} is not available for those dates and no alternatives were found in the next ${SEARCH_WINDOW_DAYS} days.`
  }

  const slots = suggestions.map((s, i) => `${i + 1}. ${formatSlot(s, durationMs, ctx.timezone)}`).join('\n')
  return `${ctx.resource.name} is not available for those dates. Nearest available slots (${ctx.timezone}):\n${slots}`
}

// ─── Tool builders ──────────────────────────────────────────────────

function buildCheckAvailabilityTool(agent: VibeAgent): RegisteredTool {
  const resourceNames = agent.bookingConfig!.resources.map(r => r.name).join(', ')

  return {
    function: {
      name: 'check_calendar_availability',
      description:
        `Check if a resource is available for a date range. Available resources: ${resourceNames}. ` +
        `If unavailable, suggests up to 3 nearest free slots. ` +
        `Always call this before submit_enquiry.`,
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

      const ctx = await resolveResource(agent, resourceName)
      if (!ctx) return `Unknown resource "${resourceName}". Available: ${resourceNames}.`

      let accessToken: string
      try {
        accessToken = await getValidAccessToken(ctx.connection)
      } catch {
        return 'Unable to check availability right now — calendar connection error. Please try again later.'
      }

      const startMs = startDate.getTime()
      const durationMs = endDate.getTime() - startMs

      try {
        return await queryAvailability(accessToken, ctx, startMs, durationMs, startDatetime, endDatetime)
      } catch (err) {
        return `Error checking availability: ${err instanceof Error ? err.message : 'Unknown error'}`
      }
    }
  }
}

function buildSubmitEnquiryTool(agent: VibeAgent): RegisteredTool {
  const resourceNames = agent.bookingConfig!.resources.map(r => r.name).join(', ')

  return {
    function: {
      name: 'submit_enquiry',
      description:
        `Submit a booking enquiry for a resource. Available resources: ${resourceNames}. ` +
        `Always call check_calendar_availability first. ` +
        `Collect guest_name, guest_email, and guest_phone before submitting.`,
      parameters: {
        type: 'object',
        properties: {
          resource_name: { type: 'string', description: `Name of the resource. One of: ${resourceNames}.` },
          start_datetime: { type: 'string', description: 'Start date and time in YYYY-MM-DDTHH:MM format.' },
          end_datetime: { type: 'string', description: 'End date and time in YYYY-MM-DDTHH:MM format.' },
          guest_name: { type: 'string', description: 'Full name of the guest.' },
          guest_email: { type: 'string', description: 'Email address of the guest.' },
          guest_phone: { type: 'string', description: 'Phone number of the guest.' },
          guest_count: { type: 'number', description: 'Number of guests (optional).' },
          notes: { type: 'string', description: 'Special requirements or notes (optional).' }
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

      const ctx = await resolveResource(agent, resourceName)
      if (!ctx) return `Unknown resource "${resourceName}". Available: ${resourceNames}.`

      try {
        const { createEnquiry } = await import('@/lib/booking-enquiries/create')
        const enquiryId = await createEnquiry({
          agent,
          resourceName: ctx.resource.name,
          calendarId: ctx.calendarId,
          calendarName: ctx.calendarName,
          timezone: ctx.timezone,
          startDatetime,
          endDatetime,
          guestName,
          guestEmail,
          guestPhone,
          guestCount: typeof args.guest_count === 'number' ? args.guest_count : undefined,
          notes: args.notes ? String(args.notes).trim() : undefined
        })

        return (
          `Enquiry submitted for ${ctx.resource.name} from ${startDatetime} to ${endDatetime}. ` +
          `The host will review and contact you at ${guestEmail}. Reference: ${enquiryId}`
        )
      } catch (err) {
        return `Error submitting enquiry: ${err instanceof Error ? err.message : 'Unknown error'}`
      }
    }
  }
}

// ─── Feature entry point ─────────────────────────────────────────────

/**
 * Returns both simple-booking tools when the feature is enabled.
 * Returns [] if disabled or no resources configured.
 * Called by context-builder — never alongside buildCalendarAvailabilityTools.
 */
export function buildSimpleBookingTools(agent: VibeAgent): RegisteredTool[] {
  const config = agent.bookingConfig
  if (!config?.enabled || config.resources.length === 0) return []

  return [
    buildCheckAvailabilityTool(agent),
    buildSubmitEnquiryTool(agent)
  ]
}
