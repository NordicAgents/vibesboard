import { and, eq, gte, lte, inArray } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { bookings } from '@vibesboard/adapter-postgres/schema'
import type { BookingDocument, CalendarProvider } from '@vibesboard/contracts'
import { rowToBooking } from './db.ts'

type Db = PostgresJsDatabase<typeof schema>
const ACTIVE: ('confirmed' | 'rescheduled')[] = ['confirmed', 'rescheduled']

export interface UpsertBookingParams {
  tenantId: string
  agentId: string
  conversationId?: string | null
  calendarConnectionId: string
  provider: CalendarProvider
  externalEventId: string
  title: string
  startTime: string
  endTime: string
  timezone: string
  attendeeName: string
  attendeeEmail: string
  description?: string
  meetLink?: string
}

/**
 * Insert a booking, idempotent on the active natural key
 * (agent_id, start_time, attendee_email). On conflict the existing active
 * booking is returned — mirrors the deterministic-id retry behavior so a
 * Google Calendar timeout retry never double-books.
 */
export async function upsertBooking(
  p: UpsertBookingParams,
  db: Db = getMigrateDb(),
): Promise<BookingDocument> {
  const inserted = await db
    .insert(bookings)
    .values({
      id: uuidv7(),
      tenantId: p.tenantId,
      agentId: p.agentId,
      conversationId: p.conversationId ?? null,
      calendarConnectionId: p.calendarConnectionId,
      provider: p.provider,
      externalEventId: p.externalEventId,
      title: p.title,
      startTime: new Date(p.startTime),
      endTime: new Date(p.endTime),
      timezone: p.timezone,
      attendeeName: p.attendeeName,
      attendeeEmail: p.attendeeEmail,
      description: p.description ?? null,
      meetLink: p.meetLink ?? null,
      status: 'confirmed',
    })
    .onConflictDoNothing({
      target: [bookings.agentId, bookings.startTime, bookings.attendeeEmail],
      where: inArray(bookings.status, ACTIVE),
    })
    .returning()
  if (inserted[0]) return rowToBooking(inserted[0])
  // Conflict: an active booking already exists — return it.
  const existing = await findActiveBookingByAttendee(
    p.tenantId,
    p.agentId,
    p.attendeeEmail,
    p.startTime,
    db,
  )
  return existing!
}

export async function findActiveBookingByAttendee(
  tenantId: string,
  agentId: string,
  attendeeEmail: string,
  startTime: string,
  db: Db = getMigrateDb(),
): Promise<BookingDocument | null> {
  const rows = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.agentId, agentId),
        eq(bookings.attendeeEmail, attendeeEmail),
        inArray(bookings.status, ACTIVE),
      ),
    )
  const target = new Date(startTime).getTime()
  const match = rows.find(
    (r) => Math.abs(r.startTime.getTime() - target) < 60_000, // 1-min tolerance
  )
  return match ? rowToBooking(match) : null
}

export async function setBookingStatus(
  tenantId: string,
  bookingId: string,
  patch: {
    status: 'cancelled' | 'rescheduled'
    startTime?: string
    endTime?: string
    cancelledAt?: string
  },
  db: Db = getMigrateDb(),
): Promise<void> {
  await db
    .update(bookings)
    .set({
      status: patch.status,
      ...(patch.startTime ? { startTime: new Date(patch.startTime) } : {}),
      ...(patch.endTime ? { endTime: new Date(patch.endTime) } : {}),
      ...(patch.cancelledAt ? { cancelledAt: new Date(patch.cancelledAt) } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId)))
}

export async function listBookingsForDay(
  tenantId: string,
  agentId: string,
  date: string, // YYYY-MM-DD
  attendeeEmail: string | null,
  db: Db = getMigrateDb(),
): Promise<BookingDocument[]> {
  const dayStart = new Date(`${date}T00:00:00.000Z`)
  const dayEnd = new Date(`${date}T23:59:59.999Z`)
  const rows = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.agentId, agentId),
        gte(bookings.startTime, dayStart),
        lte(bookings.startTime, dayEnd),
        inArray(bookings.status, ACTIVE),
      ),
    )
    .orderBy(bookings.startTime)
  const mapped = rows.map(rowToBooking)
  return attendeeEmail
    ? mapped.filter(
        (b) => b.attendeeEmail.toLowerCase() === attendeeEmail.toLowerCase(),
      )
    : mapped
}
