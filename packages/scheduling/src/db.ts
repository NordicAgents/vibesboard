import type {
  CalendarConnection,
  Booking,
} from '@vibesboard/adapter-postgres/schema'
import type {
  CalendarConnectionDocument,
  BookingDocument,
} from '@vibesboard/contracts'

export const rowToCalendarConnection = (
  r: CalendarConnection,
): CalendarConnectionDocument => ({
  id: r.id,
  tenantId: r.tenantId,
  provider: r.provider,
  name: r.name,
  calendarId: r.calendarId,
  accessToken: r.accessTokenEncrypted,
  refreshToken: r.refreshTokenEncrypted,
  tokenExpiresAt: r.tokenExpiresAt?.toISOString() ?? new Date(0).toISOString(),
  apiKey: r.apiKeyEncrypted ?? undefined,
  apiBaseUrl: r.apiBaseUrl ?? undefined,
  email: r.email ?? undefined,
  scopes: r.scopes ?? [],
  status: r.status,
  connectedBy: r.connectedBy ?? '',
  connectedAt: r.connectedAt.toISOString(),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})

export const rowToBooking = (r: Booking): BookingDocument => ({
  id: r.id,
  agentId: r.agentId,
  tenantId: r.tenantId,
  conversationId: r.conversationId ?? '',
  calendarConnectionId: r.calendarConnectionId,
  provider: r.provider,
  externalEventId: r.externalEventId,
  title: r.title,
  startTime: r.startTime.toISOString(),
  endTime: r.endTime.toISOString(),
  timezone: r.timezone,
  attendeeName: r.attendeeName,
  attendeeEmail: r.attendeeEmail,
  description: r.description ?? undefined,
  meetLink: r.meetLink ?? undefined,
  status: r.status,
  cancelledAt: r.cancelledAt?.toISOString() ?? undefined,
  rescheduledTo: r.rescheduledTo ?? undefined,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})
