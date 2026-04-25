// lib/agent/actions/booking/tools.ts
import {
  getCalendarConnection,
  getValidAccessToken
} from '@/lib/scheduling/connections'
import {
  listCalendarEvents,
  getCalendarEvent,
  createCalendarEvent,
  updateCalendarEvent as updateCalEvent,
  deleteCalendarEvent as deleteCalEvent
} from '@/lib/scheduling/providers/google-calendar'
import {
  checkFreeBusy,
  parseWallClock,
  formatDateRange,
  type BusySlot
} from '../shared/calendar'
import {
  findOverlappingCalendarEvents,
  formatMultiResourceAvailability,
  type ResourceAvailabilityResult
} from './availability'
import type {
  CalendarConnectionDocument,
  BookableResource
} from '@/lib/firestore-types'
import type { VibeAgent } from '@/lib/types'
import type { RegisteredTool } from '@/lib/agent/tools/base'
import type { ActionContext } from '../types'
import type { BookingConfig } from './types'

// ─── Constants ──────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SEARCH_WINDOW_DAYS = 60
const MAX_SUGGESTIONS = 3

function validateDatetimeRange(
  startDatetime: string,
  endDatetime: string
): string | null {
  const startDate = parseWallClock(startDatetime)
  const endDate = parseWallClock(endDatetime)
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return 'Invalid datetime format. Use YYYY-MM-DDTHH:MM (e.g. 2026-05-10T14:00).'
  }
  if (startDate.getTime() < Date.now())
    return 'Start date cannot be in the past.'
  if (endDate <= startDate) return 'End datetime must be after start datetime.'
  return null
}

// ─── Types ──────────────────────────────────────────────────────────

interface ResolvedResource {
  resource: BookableResource
  connection: CalendarConnectionDocument
  accessToken: string
  calendarId: string
  calendarName: string
  timezone: string
}

// ─── Helpers ────────────────────────────────────────────────────────

async function resolveResource(
  agent: VibeAgent,
  config: BookingConfig,
  resourceName: string
): Promise<ResolvedResource | null> {
  const resource = config.resources.find(
    r => r.name.toLowerCase() === resourceName.toLowerCase()
  )
  if (!resource) return null

  const connection = await getCalendarConnection(
    agent.tenantId!,
    resource.calendarConnectionId
  )
  if (!connection) return null

  let accessToken: string
  try {
    accessToken = await getValidAccessToken(connection)
  } catch {
    return null
  }

  return {
    resource,
    connection,
    accessToken,
    calendarId: resource.calendarId,
    calendarName: resource.calendarName,
    timezone: resource.timezone
  }
}

async function resolveAllResources(
  agent: VibeAgent,
  config: BookingConfig
): Promise<ResolvedResource[]> {
  const results: ResolvedResource[] = []
  for (const resource of config.resources) {
    const connection = await getCalendarConnection(
      agent.tenantId!,
      resource.calendarConnectionId
    )
    if (!connection) continue
    try {
      const accessToken = await getValidAccessToken(connection)
      results.push({
        resource,
        connection,
        accessToken,
        calendarId: resource.calendarId,
        calendarName: resource.calendarName,
        timezone: resource.timezone
      })
    } catch {
      continue
    }
  }
  return results
}

function buildTitle(
  template: string,
  guestName: string,
  guestCount: number
): string {
  return template
    .replace('{guest_name}', guestName)
    .replace('{guest_count}', String(guestCount))
}

function buildDescription(guestName: string, guestCount: number): string {
  return `Guest: ${guestName}\nGuests: ${guestCount}`
}

function parseGuestInfo(
  description: string
): { name: string; count: number } | null {
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
      const overlap = busySlots.find(
        b => fCursor < b.end && fCursor + durationMs > b.start
      )
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
      const overlap = busySlots.find(
        b => bCursor < b.end && bCursor + durationMs > b.start
      )
      bCursor = overlap ? overlap.start - durationMs : bCursor - durationMs
    }
  }

  return [...backward, ...forward]
    .sort((a, b) => Math.abs(a - requestedStart) - Math.abs(b - requestedStart))
    .slice(0, MAX_SUGGESTIONS)
    .sort((a, b) => a - b)
}

// ─── Tool: check_booking_availability ──────────────────────────────

function buildCheckAvailabilityTool(
  agent: VibeAgent,
  config: BookingConfig
): RegisteredTool {
  const resourceNames = config.resources.map(r => r.name).join(', ')
  const isDirect = config.mode === 'direct'

  return {
    function: {
      name: 'check_booking_availability',
      description:
        `Check if one or all resources are available for a date range. Available resources: ${resourceNames}. ` +
        (isDirect
          ? `If resource_name is omitted, checks all resources. `
          : '') +
        `If unavailable, suggests up to 3 nearest free slots. ` +
        `Always call this before create_booking.`,
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
        required: isDirect
          ? ['start_datetime', 'end_datetime']
          : ['resource_name', 'start_datetime', 'end_datetime']
      }
    },
    execute: async args => {
      const resourceName = String(args.resource_name ?? '').trim()
      const startDatetime = String(args.start_datetime ?? '').trim()
      const endDatetime = String(args.end_datetime ?? '').trim()

      const validationError = validateDatetimeRange(startDatetime, endDatetime)
      if (validationError) return validationError

      const startDate = parseWallClock(startDatetime)
      const endDate = parseWallClock(endDatetime)

      if (!resourceName && isDirect) {
        const resources = await resolveAllResources(agent, config)
        if (resources.length === 0) {
          return 'No calendar connections available.'
        }

        try {
          const results: ResourceAvailabilityResult[] = []
          const startMs = startDate.getTime()
          const endMs = endDate.getTime()

          for (const { resource, accessToken, calendarId } of resources) {
            const busySlots = await checkFreeBusy(
              accessToken,
              calendarId,
              startDate,
              endDate
            )
            results.push({
              resourceName: resource.name,
              available: !busySlots.some(
                b => startMs < b.end && endMs > b.start
              )
            })
          }

          return formatMultiResourceAvailability({
            startDatetime,
            endDatetime,
            timezone: 'resource timezones',
            results
          })
        } catch (err) {
          return `Error checking availability: ${err instanceof Error ? err.message : 'Unknown error'}`
        }
      }

      if (!resourceName) {
        return `resource_name is required. Available: ${resourceNames}.`
      }

      const resolved = await resolveResource(agent, config, resourceName)
      if (!resolved)
        return `Unknown resource "${resourceName}". Available: ${resourceNames}.`

      const { accessToken, calendarId, timezone } = resolved

      if (!accessToken) {
        return 'Unable to check availability right now — calendar connection error. Please try again later.'
      }

      const startMs = startDate.getTime()
      const durationMs = endDate.getTime() - startMs
      const now = Date.now()
      const windowEnd = new Date(
        startMs + SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000
      )

      try {
        const busySlots = await checkFreeBusy(
          accessToken,
          calendarId,
          new Date(now),
          windowEnd
        )
        const hasConflict = busySlots.some(
          b => startMs < b.end && startMs + durationMs > b.start
        )

        if (!hasConflict) {
          return `${resolved.resource.name} is available from ${startDatetime} to ${endDatetime} (${timezone}).`
        }

        const suggestions = findNearestSlots(
          busySlots,
          startMs,
          durationMs,
          now
        )
        if (suggestions.length === 0) {
          return `${resolved.resource.name} is not available for those dates and no alternatives were found in the next ${SEARCH_WINDOW_DAYS} days.`
        }

        const slots = suggestions
          .map(
            (s, i) => `${i + 1}. ${formatDateRange(s, durationMs, timezone)}`
          )
          .join('\n')
        return `${resolved.resource.name} is not available for those dates. Nearest available slots (${timezone}):\n${slots}`
      } catch (err) {
        return `Error checking availability: ${err instanceof Error ? err.message : 'Unknown error'}`
      }
    }
  }
}

// ─── Tool: create_booking (enquiry OR direct) ───────────────────────

function buildCreateBookingTool(
  agent: VibeAgent,
  config: BookingConfig
): RegisteredTool {
  const resourceNames = config.resources.map(r => r.name).join(', ')
  const isEnquiry = config.mode === 'enquiry'

  const titleTemplate =
    config.eventTitleTemplate ?? '{guest_name} ({guest_count} guests)'
  const timeMode = config.eventTimeMode ?? 'all-day'
  const overlapProtection = config.overlapProtection !== false

  return {
    function: {
      name: 'create_booking',
      description: isEnquiry
        ? `Submit a booking enquiry for a resource. Available resources: ${resourceNames}. ` +
          `Always call check_booking_availability first. ` +
          `Collect guest_name, guest_email, and guest_phone before submitting.`
        : `Create a booking on a resource's calendar. Available resources: ${resourceNames}. ` +
          `Always confirm details with the owner before calling this tool.`,
      parameters: {
        type: 'object',
        properties: isEnquiry
          ? {
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
              },
              guest_name: {
                type: 'string',
                description: 'Full name of the guest.'
              },
              guest_email: {
                type: 'string',
                description: 'Email address of the guest.'
              },
              guest_phone: {
                type: 'string',
                description: 'Phone number of the guest.'
              },
              guest_count: {
                type: 'number',
                description: 'Number of guests (optional).'
              },
              notes: {
                type: 'string',
                description: 'Special requirements or notes (optional).'
              }
            }
          : {
              resource_name: {
                type: 'string',
                description: `Resource name. One of: ${resourceNames}.`
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
              guest_count: { type: 'number', description: 'Number of guests.' }
            },
        required: isEnquiry
          ? [
              'resource_name',
              'start_datetime',
              'end_datetime',
              'guest_name',
              'guest_email',
              'guest_phone'
            ]
          : [
              'resource_name',
              'check_in_date',
              'check_out_date',
              'guest_name',
              'guest_count'
            ]
      }
    },
    execute: async args => {
      if (isEnquiry) {
        // ─── Enquiry mode ──────────────────────────────────────────
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
        if (startDate.getTime() < Date.now())
          return 'Start date cannot be in the past.'
        if (endDate <= startDate)
          return 'End datetime must be after start datetime.'
        if (!EMAIL_REGEX.test(guestEmail))
          return 'Invalid email address format.'

        const resolved = await resolveResource(agent, config, resourceName)
        if (!resolved)
          return `Unknown resource "${resourceName}". Available: ${resourceNames}.`

        try {
          const { createEnquiry } =
            await import('@/lib/booking-enquiries/create')
          const enquiryId = await createEnquiry({
            agent,
            resourceName: resolved.resource.name,
            calendarId: resolved.calendarId,
            calendarName: resolved.calendarName,
            timezone: resolved.timezone,
            startDatetime,
            endDatetime,
            guestName,
            guestEmail,
            guestPhone,
            guestCount:
              typeof args.guest_count === 'number'
                ? args.guest_count
                : undefined,
            notes: args.notes ? String(args.notes).trim() : undefined
          })

          return (
            `Enquiry submitted for ${resolved.resource.name} from ${startDatetime} to ${endDatetime}. ` +
            `The host will review and contact you at ${guestEmail}. Reference: ${enquiryId}`
          )
        } catch (err) {
          return `Error submitting enquiry: ${err instanceof Error ? err.message : 'Unknown error'}`
        }
      } else {
        // ─── Direct mode ───────────────────────────────────────────
        const resourceName = String(args.resource_name ?? '').trim()
        const checkIn = String(args.check_in_date ?? '').trim()
        const checkOut = String(args.check_out_date ?? '').trim()
        const guestName = String(args.guest_name ?? '').trim()
        const guestCount =
          typeof args.guest_count === 'number' ? args.guest_count : 1

        if (!resourceName || !checkIn || !checkOut || !guestName) {
          return 'Missing required fields: resource_name, check_in_date, check_out_date, guest_name.'
        }
        if (checkOut <= checkIn)
          return 'check_out_date must be after check_in_date.'

        const resolved = await resolveResource(agent, config, resourceName)
        if (!resolved)
          return `Unknown resource "${resourceName}". Available: ${resourceNames}.`

        const { resource, accessToken } = resolved

        try {
          if (overlapProtection) {
            const existing = await listCalendarEvents(
              accessToken,
              resource.calendarId,
              `${checkIn}T00:00:00`,
              `${checkOut}T23:59:59`
            )
            const conflicts = findOverlappingCalendarEvents(
              existing,
              checkIn,
              checkOut
            )
            if (conflicts.length > 0) {
              const conflictLines = conflicts
                .map(
                  ev =>
                    `- ${ev.summary} | ${formatEventDate(ev.start, resource.timezone)} → ${formatEventDate(ev.end, resource.timezone)}`
                )
                .join('\n')
              return `Cannot create booking — ${resource.name} has overlapping bookings:\n${conflictLines}`
            }
          }

          const title = buildTitle(titleTemplate, guestName, guestCount)
          const description = buildDescription(guestName, guestCount)

          let startField: {
            date?: string
            dateTime?: string
            timeZone?: string
          }
          let endField: { date?: string; dateTime?: string; timeZone?: string }

          if (timeMode === 'all-day') {
            startField = { date: checkIn }
            endField = { date: checkOut }
          } else {
            startField = {
              dateTime: `${checkIn}T14:00:00`,
              timeZone: resource.timezone
            }
            endField = {
              dateTime: `${checkOut}T11:00:00`,
              timeZone: resource.timezone
            }
          }

          const created = await createCalendarEvent(
            accessToken,
            resource.calendarId,
            {
              summary: title,
              description,
              start: startField,
              end: endField
            }
          )

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
}

// ─── Tool: list_bookings (direct mode only) ─────────────────────────

function buildListBookingsTool(
  agent: VibeAgent,
  config: BookingConfig
): RegisteredTool {
  const resourceNames = config.resources.map(r => r.name).join(', ')

  return {
    function: {
      name: 'list_bookings',
      description:
        `List booking events from resource calendars. Available resources: ${resourceNames}. ` +
        `If resource_name is omitted, lists events across all resources.`,
      parameters: {
        type: 'object',
        properties: {
          resource_name: {
            type: 'string',
            description: `Resource name (optional). One of: ${resourceNames}. Omit to query all resources.`
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
    execute: async args => {
      const resourceName = args.resource_name
        ? String(args.resource_name).trim()
        : ''
      const startDate = String(args.start_date ?? '').trim()
      const endDate = String(args.end_date ?? '').trim()

      if (!startDate || !endDate)
        return 'start_date and end_date are required (YYYY-MM-DD).'

      let resources: ResolvedResource[]
      if (resourceName) {
        const resolved = await resolveResource(agent, config, resourceName)
        if (!resolved)
          return `Unknown resource "${resourceName}". Available: ${resourceNames}.`
        resources = [resolved]
      } else {
        resources = await resolveAllResources(agent, config)
        if (resources.length === 0) return 'No calendar connections available.'
      }

      try {
        const allEvents: Array<{
          resource: string
          id: string
          title: string
          rawStart: string
          start: string
          end: string
          description: string
        }> = []

        for (const { resource, accessToken } of resources) {
          const events = await listCalendarEvents(
            accessToken,
            resource.calendarId,
            `${startDate}T00:00:00`,
            `${endDate}T23:59:59`
          )
          for (const ev of events) {
            allEvents.push({
              resource: resource.name,
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
          const scope = resourceName || 'all resources'
          return `No bookings found for ${scope} between ${startDate} and ${endDate}.`
        }

        allEvents.sort((a, b) => a.rawStart.localeCompare(b.rawStart))

        const lines = allEvents.map(
          ev =>
            `- [${ev.resource}] ${ev.title} | ${ev.start} → ${ev.end} | Event ID: ${ev.id}${ev.description ? ` | ${ev.description}` : ''}`
        )
        return `Found ${allEvents.length} booking(s):\n${lines.join('\n')}`
      } catch (err) {
        return `Error listing bookings: ${err instanceof Error ? err.message : 'Unknown error'}`
      }
    }
  }
}

// ─── Tool: update_booking (direct mode only) ────────────────────────

function buildUpdateBookingTool(
  agent: VibeAgent,
  config: BookingConfig
): RegisteredTool {
  const resourceNames = config.resources.map(r => r.name).join(', ')
  const titleTemplate =
    config.eventTitleTemplate ?? '{guest_name} ({guest_count} guests)'
  const timeMode = config.eventTimeMode ?? 'all-day'
  const overlapProtection = config.overlapProtection !== false

  return {
    function: {
      name: 'update_booking',
      description:
        `Update an existing booking event. Available resources: ${resourceNames}. ` +
        `Use list_bookings first to find the event_id. ` +
        `Always confirm changes with the owner before calling this tool.`,
      parameters: {
        type: 'object',
        properties: {
          event_id: {
            type: 'string',
            description: 'Google Calendar event ID (from list_bookings).'
          },
          resource_name: {
            type: 'string',
            description: `Resource name. One of: ${resourceNames}.`
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
    execute: async args => {
      const eventId = String(args.event_id ?? '').trim()
      const resourceName = String(args.resource_name ?? '').trim()
      const checkIn = args.check_in_date
        ? String(args.check_in_date).trim()
        : undefined
      const checkOut = args.check_out_date
        ? String(args.check_out_date).trim()
        : undefined
      const guestName = args.guest_name
        ? String(args.guest_name).trim()
        : undefined
      const guestCount =
        typeof args.guest_count === 'number' ? args.guest_count : undefined

      if (!eventId || !resourceName)
        return 'event_id and resource_name are required.'

      const resolved = await resolveResource(agent, config, resourceName)
      if (!resolved)
        return `Unknown resource "${resourceName}". Available: ${resourceNames}.`

      const { resource, accessToken } = resolved

      try {
        let currentEvent: Awaited<ReturnType<typeof getCalendarEvent>> | null =
          null
        if (
          (overlapProtection && (checkIn || checkOut)) ||
          guestName ||
          guestCount !== undefined
        ) {
          currentEvent = await getCalendarEvent(
            accessToken,
            resource.calendarId,
            eventId
          )
        }

        if (overlapProtection && (checkIn || checkOut)) {
          const effectiveCheckIn =
            checkIn ?? currentEvent!.start.split('T')[0] ?? ''
          const effectiveCheckOut =
            checkOut ?? currentEvent!.end.split('T')[0] ?? ''
          if (effectiveCheckOut <= effectiveCheckIn)
            return 'check_out_date must be after check_in_date.'
          const existing = await listCalendarEvents(
            accessToken,
            resource.calendarId,
            `${effectiveCheckIn}T00:00:00`,
            `${effectiveCheckOut}T23:59:59`
          )
          const conflicts = findOverlappingCalendarEvents(
            existing,
            effectiveCheckIn,
            effectiveCheckOut
          ).filter(ev => ev.id !== eventId)
          if (conflicts.length > 0) {
            const lines = conflicts
              .map(
                ev =>
                  `- ${ev.summary} | ${formatEventDate(ev.start, resource.timezone)} → ${formatEventDate(ev.end, resource.timezone)}`
              )
              .join('\n')
            return `Cannot update — new dates overlap with existing bookings:\n${lines}`
          }
        }

        const updates: Record<string, unknown> = {}

        if (guestName || guestCount !== undefined) {
          const existingInfo = currentEvent?.description
            ? parseGuestInfo(currentEvent.description)
            : null
          const currentName = guestName ?? existingInfo?.name ?? 'Guest'
          const currentCount = guestCount ?? existingInfo?.count ?? 1
          updates.summary = buildTitle(titleTemplate, currentName, currentCount)
          updates.description = buildDescription(currentName, currentCount)
        }

        if (checkIn) {
          if (timeMode === 'all-day') {
            updates.start = { date: checkIn }
          } else {
            updates.start = {
              dateTime: `${checkIn}T14:00:00`,
              timeZone: resource.timezone
            }
          }
        }

        if (checkOut) {
          if (timeMode === 'all-day') {
            updates.end = { date: checkOut }
          } else {
            updates.end = {
              dateTime: `${checkOut}T11:00:00`,
              timeZone: resource.timezone
            }
          }
        }

        if (Object.keys(updates).length === 0) return 'No changes specified.'

        const updated = await updateCalEvent(
          accessToken,
          resource.calendarId,
          eventId,
          updates
        )

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

// ─── Tool: cancel_booking (direct mode only) ────────────────────────

function buildCancelBookingTool(
  agent: VibeAgent,
  config: BookingConfig
): RegisteredTool {
  const resourceNames = config.resources.map(r => r.name).join(', ')

  return {
    function: {
      name: 'cancel_booking',
      description:
        `Cancel (delete) a booking event. Available resources: ${resourceNames}. ` +
        `Use list_bookings first to find the event_id. ` +
        `Always confirm with the owner before calling this tool.`,
      parameters: {
        type: 'object',
        properties: {
          event_id: {
            type: 'string',
            description: 'Google Calendar event ID (from list_bookings).'
          },
          resource_name: {
            type: 'string',
            description: `Resource name. One of: ${resourceNames}.`
          }
        },
        required: ['event_id', 'resource_name']
      }
    },
    execute: async args => {
      const eventId = String(args.event_id ?? '').trim()
      const resourceName = String(args.resource_name ?? '').trim()

      if (!eventId || !resourceName)
        return 'event_id and resource_name are required.'

      const resolved = await resolveResource(agent, config, resourceName)
      if (!resolved)
        return `Unknown resource "${resourceName}". Available: ${resourceNames}.`

      const { resource, accessToken } = resolved

      try {
        await deleteCalEvent(accessToken, resource.calendarId, eventId)
        return `Booking cancelled from ${resource.name}. Event ID: ${eventId}`
      } catch (err) {
        return `Error cancelling booking: ${err instanceof Error ? err.message : 'Unknown error'}`
      }
    }
  }
}

// ─── Module entry point ──────────────────────────────────────────────

export async function buildBookingTools(
  ctx: ActionContext
): Promise<RegisteredTool[]> {
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
