import type { CalendarConnectionDocument } from '@vibesboard/contracts'
import type { SchedulingProvider } from './types.ts'
import { GoogleCalendarProvider } from './google-calendar.ts'

export function createProvider(
  connection: CalendarConnectionDocument,
  accessToken: string
): SchedulingProvider {
  switch (connection.provider) {
    case 'google_calendar':
      return new GoogleCalendarProvider({
        accessToken,
        calendarId: connection.calendarId
      })
    default:
      throw new Error(`Unsupported calendar provider: ${connection.provider}`)
  }
}

export type {
  SchedulingProvider,
  TimeSlot,
  CreateEventParams,
  CreateEventResult
} from './types.ts'

// Re-export the Google Calendar implementation surface so consumers that
// imported from '@/lib/scheduling/providers/google-calendar' (now shimmed
// to '@vibesboard/scheduling/providers') keep working unchanged.
export {
  GoogleCalendarProvider,
  listCalendarEvents,
  getCalendarEvent,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  type CalendarEvent
} from './google-calendar.ts'
