import type { CalendarConnectionDocument } from '@/lib/firestore-types'
import type { SchedulingProvider } from './types'
import { GoogleCalendarProvider } from './google-calendar'

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
} from './types'
