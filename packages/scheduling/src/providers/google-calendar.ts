import type {
  SchedulingProvider,
  TimeSlot,
  CreateEventParams,
  CreateEventResult
} from './types.ts'

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

interface GoogleCalendarProviderConfig {
  accessToken: string
  calendarId: string
}

export class GoogleCalendarProvider implements SchedulingProvider {
  private accessToken: string
  private calendarId: string

  constructor(config: GoogleCalendarProviderConfig) {
    this.accessToken = config.accessToken
    this.calendarId = config.calendarId
  }

  private async request(path: string, options: RequestInit = {}) {
    const url = `${GOOGLE_CALENDAR_API}${path}`
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Google Calendar API error (${res.status}): ${text}`)
    }

    if (res.status === 204) return null
    return res.json()
  }

  async checkAvailability(params: {
    date: string
    durationMinutes: number
    timezone: string
    availableHours: { start: string; end: string }
    availableDays: number[]
    bufferMinutes: number
  }): Promise<TimeSlot[]> {
    const {
      date,
      durationMinutes,
      timezone,
      availableHours,
      availableDays,
      bufferMinutes
    } = params

    // Check if the requested date's day-of-week is in available days
    const requestedDate = new Date(`${date}T00:00:00`)
    const dayOfWeek = requestedDate.getDay()
    if (!availableDays.includes(dayOfWeek)) {
      return []
    }

    const dayStart = `${date}T${availableHours.start}:00`
    const dayEnd = `${date}T${availableHours.end}:00`

    // Query free/busy
    const freeBusyRes = await this.request('/freeBusy', {
      method: 'POST',
      body: JSON.stringify({
        timeMin: new Date(
          `${dayStart}${getTimezoneOffset(timezone, date)}`
        ).toISOString(),
        timeMax: new Date(
          `${dayEnd}${getTimezoneOffset(timezone, date)}`
        ).toISOString(),
        timeZone: timezone,
        items: [{ id: this.calendarId }]
      })
    })

    const busySlots: Array<{ start: string; end: string }> =
      freeBusyRes?.calendars?.[this.calendarId]?.busy ?? []

    // Generate available slots
    const slots: TimeSlot[] = []
    const slotDurationMs = durationMinutes * 60 * 1000
    const bufferMs = bufferMinutes * 60 * 1000

    // Parse start/end as local time in the given timezone
    let cursor = new Date(`${dayStart}${getTimezoneOffset(timezone, date)}`)
    const endBoundary = new Date(
      `${dayEnd}${getTimezoneOffset(timezone, date)}`
    )

    while (cursor.getTime() + slotDurationMs <= endBoundary.getTime()) {
      const slotStart = cursor.toISOString()
      const slotEnd = new Date(cursor.getTime() + slotDurationMs).toISOString()

      // Check if this slot overlaps with any busy period
      const isAvailable = !busySlots.some(busy => {
        const busyStart = new Date(busy.start).getTime()
        const busyEnd = new Date(busy.end).getTime()
        const candidateStart = cursor.getTime()
        const candidateEnd = candidateStart + slotDurationMs
        return candidateStart < busyEnd && candidateEnd > busyStart
      })

      if (isAvailable) {
        slots.push({ start: slotStart, end: slotEnd })
      }

      // Move cursor forward by slot duration + buffer
      cursor = new Date(cursor.getTime() + slotDurationMs + bufferMs)
    }

    return slots
  }

  async createEvent(params: CreateEventParams): Promise<CreateEventResult> {
    const body: Record<string, any> = {
      summary: params.title,
      description: params.description ?? '',
      start: {
        dateTime: params.startTime,
        timeZone: params.timezone
      },
      end: {
        dateTime: params.endTime,
        timeZone: params.timezone
      },
      attendees: [
        { email: params.attendeeEmail, displayName: params.attendeeName }
      ],
      reminders: {
        useDefault: true
      }
    }

    if (params.createMeetLink) {
      body.conferenceData = {
        createRequest: {
          requestId: `vibeagent-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      }
    }

    const queryParams = params.createMeetLink
      ? '?conferenceDataVersion=1&sendUpdates=all'
      : '?sendUpdates=all'

    const event = await this.request(
      `/calendars/${encodeURIComponent(this.calendarId)}/events${queryParams}`,
      { method: 'POST', body: JSON.stringify(body) }
    )

    return {
      eventId: event.id,
      meetLink:
        event.conferenceData?.entryPoints?.find(
          (e: any) => e.entryPointType === 'video'
        )?.uri ?? undefined,
      htmlLink: event.htmlLink
    }
  }

  async updateEvent(
    eventId: string,
    params: Partial<CreateEventParams>
  ): Promise<void> {
    const body: Record<string, any> = {}

    if (params.title) body.summary = params.title
    if (params.description !== undefined) body.description = params.description
    if (params.startTime) {
      body.start = {
        dateTime: params.startTime,
        timeZone: params.timezone
      }
    }
    if (params.endTime) {
      body.end = {
        dateTime: params.endTime,
        timeZone: params.timezone
      }
    }
    if (params.attendeeEmail) {
      body.attendees = [
        { email: params.attendeeEmail, displayName: params.attendeeName }
      ]
    }

    await this.request(
      `/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      { method: 'PATCH', body: JSON.stringify(body) }
    )
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.request(
      `/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      { method: 'DELETE' }
    )
  }
}

/**
 * Get a simple timezone offset string for Date construction.
 * For proper timezone handling we rely on the Google API's timeZone parameter.
 * This is a fallback for creating Date objects from local time strings.
 */
function getTimezoneOffset(timezone: string, date?: string): string {
  try {
    // Use the target date to resolve the correct offset (accounts for DST)
    const targetDate = date ? new Date(`${date}T12:00:00`) : new Date()
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset'
    })
    const parts = formatter.formatToParts(targetDate)
    const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value ?? ''
    // Convert "GMT+5:30" → "+05:30"
    const match = offsetPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
    if (!match) return 'Z'
    const sign = match[1]
    const hours = match[2].padStart(2, '0')
    const minutes = match[3] ?? '00'
    return `${sign}${hours}:${minutes}`
  } catch {
    return 'Z'
  }
}

// ─── Standalone Calendar Events API (used by direct-booking tools) ───

export interface CalendarEvent {
  id: string
  summary: string
  description?: string
  start: string // ISO datetime or date
  end: string // ISO datetime or date
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
 * Get a single event from a Google Calendar by ID.
 */
export async function getCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<CalendarEvent> {
  const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
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
