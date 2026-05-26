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
