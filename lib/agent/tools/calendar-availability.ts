import { getValidAccessToken } from '@/lib/scheduling/connections'
import { fetchWithRetry } from '@/lib/utils/fetch-with-retry'
import type { CalendarConnectionDocument } from '@/lib/firestore-types'
import type { VibeAgent } from '@/lib/types'
import type { RegisteredTool } from './base'

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

interface CalendarAvailabilityContext {
  agent: VibeAgent
  connection: CalendarConnectionDocument
  calendarId: string
  resourceName: string
}

function buildCheckCalendarAvailabilityTool(ctx: CalendarAvailabilityContext): RegisteredTool {
  return {
    function: {
      name: 'check_calendar_availability',
      description: `Check if ${ctx.resourceName} is available for a given check-in to check-out date range. Returns available or unavailable based on existing calendar events.`,
      parameters: {
        type: 'object',
        properties: {
          check_in: {
            type: 'string',
            description: 'Check-in date in YYYY-MM-DD format.'
          },
          check_out: {
            type: 'string',
            description: 'Check-out date in YYYY-MM-DD format.'
          }
        },
        required: ['check_in', 'check_out']
      }
    },
    execute: async (args) => {
      const checkIn = String(args.check_in ?? '').trim()
      const checkOut = String(args.check_out ?? '').trim()

      if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) {
        return 'Please provide valid dates in YYYY-MM-DD format (e.g. 2026-05-10).'
      }

      const checkInDate = new Date(`${checkIn}T00:00:00Z`)
      const checkOutDate = new Date(`${checkOut}T00:00:00Z`)

      if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
        return 'Invalid date values. Please use YYYY-MM-DD format.'
      }

      if (checkOutDate <= checkInDate) {
        return 'Check-out date must be after check-in date.'
      }

      const today = new Date()
      today.setUTCHours(0, 0, 0, 0)

      const maxDate = new Date(today)
      maxDate.setMonth(maxDate.getMonth() + 6)

      if (checkInDate < today) {
        return 'Check-in date cannot be in the past.'
      }

      if (checkInDate > maxDate) {
        return 'Check-in date cannot be more than 6 months from today.'
      }

      const nights = Math.round(
        (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)
      )

      try {
        const accessToken = await getValidAccessToken(ctx.connection)

        const res = await fetchWithRetry(`${GOOGLE_CALENDAR_API}/freeBusy`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            timeMin: checkInDate.toISOString(),
            timeMax: checkOutDate.toISOString(),
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

        const nightLabel = `${nights} night${nights !== 1 ? 's' : ''}`

        if (busySlots.length === 0) {
          return `${ctx.resourceName} is available from ${checkIn} to ${checkOut} (${nightLabel}).`
        }

        return (
          `${ctx.resourceName} is NOT available from ${checkIn} to ${checkOut}. ` +
          `There ${busySlots.length === 1 ? 'is 1 existing booking' : `are ${busySlots.length} existing bookings`} that conflict with those dates. ` +
          `Please suggest different dates.`
        )
      } catch (error) {
        return `Error checking availability: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}

/**
 * Build the check_calendar_availability tool for agents that have
 * calendarAvailabilityConfig enabled with an active Google Calendar connection.
 */
export function buildCalendarAvailabilityTools(
  agent: VibeAgent,
  connection: CalendarConnectionDocument
): RegisteredTool[] {
  const config = agent.calendarAvailabilityConfig
  if (!config?.enabled) return []

  // Defensive check: connection must belong to the same tenant as the agent.
  // Context-builder already scopes the lookup to agent.tenantId, but guard
  // here too so this function is safe regardless of how it's called.
  if (connection.tenantId !== agent.tenantId) {
    console.error('[calendar-availability] Connection tenant mismatch — tool not injected')
    return []
  }

  const calendarId = config.calendarId ?? connection.calendarId
  if (!calendarId) {
    console.error('[calendar-availability] No calendarId configured — tool not injected')
    return []
  }

  const ctx: CalendarAvailabilityContext = {
    agent,
    connection,
    calendarId,
    resourceName: config.resourceName?.trim() || 'The resource'
  }

  return [buildCheckCalendarAvailabilityTool(ctx)]
}
