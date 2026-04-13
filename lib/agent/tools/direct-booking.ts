import { getCalendarConnection, getValidAccessToken } from '@/lib/scheduling/connections'
import {
  listCalendarEvents,
  getCalendarEvent,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent
} from '@/lib/scheduling/providers/google-calendar'
import type { CalendarConnectionDocument, BookableResource } from '@/lib/firestore-types'
import type { VibeAgent } from '@/lib/types'
import type { RegisteredTool } from './base'

// ─── Types ─────────���────────────────────────────────────────────────

interface ResolvedResource {
  resource: BookableResource
  connection: CalendarConnectionDocument
  accessToken: string
}

// ─── Helpers ────────────���───────────────────────────────────────────

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

// ─── Tool: list_calendar_events ─────────────���──────────────────────

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
          const scope = resourceName || 'all rooms'
          return `No bookings found for ${scope} between ${startDate} and ${endDate}.`
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

// ─── Tool: update_calendar_event ───────��───────────────────────────

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
        // Fetch the current event when we need it for overlap checks or guest info
        let currentEvent: Awaited<ReturnType<typeof getCalendarEvent>> | null = null
        if ((overlapProtection && (checkIn || checkOut)) || guestName || guestCount !== undefined) {
          currentEvent = await getCalendarEvent(accessToken, resource.calendarId, eventId)
        }

        if (overlapProtection && (checkIn || checkOut)) {
          const effectiveCheckIn = checkIn ?? (currentEvent!.start.split('T')[0] ?? '')
          const effectiveCheckOut = checkOut ?? (currentEvent!.end.split('T')[0] ?? '')
          if (effectiveCheckOut <= effectiveCheckIn) return 'check_out_date must be after check_in_date.'
          const existing = await listCalendarEvents(
            accessToken,
            resource.calendarId,
            `${effectiveCheckIn}T00:00:00`,
            `${effectiveCheckOut}T23:59:59`
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
          const existingInfo = currentEvent?.description ? parseGuestInfo(currentEvent.description) : null
          const currentName = guestName ?? (existingInfo?.name ?? 'Guest')
          const currentCount = guestCount ?? (existingInfo?.count ?? 1)
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

// ─── Tool: delete_calendar_event ───────────────���───────────────────

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

// ─── Feature entry point ───��─────────────────────────────────────────

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
