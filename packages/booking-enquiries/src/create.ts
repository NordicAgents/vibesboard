import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { bookingEnquiries } from '@vibesboard/adapter-postgres/schema'
import { type VibeAgent } from '@vibesboard/contracts'
import { rowToBookingEnquiry } from './db.ts'
import { notifyAdminOfEnquiry } from './notify.ts'

type Db = PostgresJsDatabase<typeof schema>

export interface CreateEnquiryParams {
  agent: VibeAgent
  resourceName: string
  calendarId: string
  calendarName: string
  timezone: string
  startDatetime: string
  endDatetime: string
  guestName: string
  guestEmail: string
  guestPhone: string
  guestCount?: number
  notes?: string
}

/**
 * Booking-enquiry datetimes arrive as wall-clock strings (e.g.
 * "2026-05-10T14:00") in the enquiry timezone. `new Date('2026-05-10T14:00')`
 * parses as *local* time, so persisting then re-reading would shift the value.
 * Treat a string without a timezone designator as UTC so the round-trip through
 * the timestamptz column is stable and matches notify.ts's UTC formatting.
 */
function toUtcDate(s: string): Date {
  return new Date(/[Z+]/.test(s) ? s : s + 'Z')
}

export async function createEnquiry(
  params: CreateEnquiryParams,
  db: Db = getMigrateDb(),
): Promise<string> {
  const id = uuidv7()
  const [row] = await db
    .insert(bookingEnquiries)
    .values({
      id,
      tenantId: params.agent.tenantId!,
      agentId: params.agent.id,
      resourceName: params.resourceName,
      calendarId: params.calendarId,
      calendarName: params.calendarName,
      timezone: params.timezone,
      startDatetime: toUtcDate(params.startDatetime),
      endDatetime: toUtcDate(params.endDatetime),
      guestName: params.guestName,
      guestEmail: params.guestEmail,
      guestPhone: params.guestPhone,
      guestCount: params.guestCount ?? null,
      notes: params.notes ?? null,
    })
    .returning()
  const doc = rowToBookingEnquiry(row)
  // Fire-and-forget — email failure must not break the guest's submission
  notifyAdminOfEnquiry(params.agent, doc).catch((err) =>
    console.error('[booking-enquiry] Failed to notify admin:', err),
  )
  return id
}
