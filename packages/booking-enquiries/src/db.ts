import type { BookingEnquiry } from '@vibesboard/adapter-postgres/schema'
import type { BookingEnquiryDocument } from '@vibesboard/contracts'

export const rowToBookingEnquiry = (
  r: BookingEnquiry,
): BookingEnquiryDocument => ({
  id: r.id,
  agentId: r.agentId,
  tenantId: r.tenantId,
  resourceName: r.resourceName,
  calendarId: r.calendarId,
  calendarName: r.calendarName,
  timezone: r.timezone,
  startDatetime: r.startDatetime.toISOString(),
  endDatetime: r.endDatetime.toISOString(),
  guestName: r.guestName,
  guestEmail: r.guestEmail,
  guestPhone: r.guestPhone,
  guestCount: r.guestCount ?? undefined,
  notes: r.notes ?? undefined,
  createdAt: r.createdAt.toISOString(),
})
