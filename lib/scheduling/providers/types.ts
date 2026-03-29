export interface TimeSlot {
  start: string // ISO datetime
  end: string   // ISO datetime
}

export interface CreateEventParams {
  title: string
  startTime: string
  endTime: string
  attendeeEmail: string
  attendeeName: string
  description?: string
  timezone: string
  createMeetLink?: boolean
}

export interface CreateEventResult {
  eventId: string
  meetLink?: string
  htmlLink?: string
}

export interface SchedulingProvider {
  checkAvailability(params: {
    date: string
    durationMinutes: number
    timezone: string
    availableHours: { start: string; end: string }
    availableDays: number[]
    bufferMinutes: number
  }): Promise<TimeSlot[]>

  createEvent(params: CreateEventParams): Promise<CreateEventResult>

  updateEvent(
    eventId: string,
    params: Partial<CreateEventParams>
  ): Promise<void>

  deleteEvent(eventId: string): Promise<void>
}
