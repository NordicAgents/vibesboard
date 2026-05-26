import { and, eq, desc } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { bookingEnquiries } from '@vibesboard/adapter-postgres/schema'
import type { BookingEnquiryDocument } from '@vibesboard/contracts'
import { rowToBookingEnquiry } from './db.ts'

type Db = PostgresJsDatabase<typeof schema>

export async function listEnquiriesForAgent(
  tenantId: string,
  agentId: string,
  limit = 100,
  db: Db = getMigrateDb(),
): Promise<BookingEnquiryDocument[]> {
  const rows = await db
    .select()
    .from(bookingEnquiries)
    .where(
      and(
        eq(bookingEnquiries.tenantId, tenantId),
        eq(bookingEnquiries.agentId, agentId),
      ),
    )
    .orderBy(desc(bookingEnquiries.createdAt))
    .limit(limit)
  return rows.map(rowToBookingEnquiry)
}
