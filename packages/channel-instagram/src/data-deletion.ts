import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import {
  instagramAccounts,
  metaDataDeletionRequests,
  type MetaDataDeletionRequest,
} from '@vibesboard/adapter-postgres/schema'

type Db = PostgresJsDatabase<typeof schema>

/**
 * Record a new Meta data-deletion request (status 'pending'). Global table —
 * keyed by Meta's confirmation code, written via the BYPASSRLS migrate client.
 */
export async function createDeletionRequest(
  confirmationCode: string,
  metaUserId: string,
  db: Db = getMigrateDb(),
): Promise<MetaDataDeletionRequest> {
  const [row] = await db
    .insert(metaDataDeletionRequests)
    .values({ confirmationCode, metaUserId, status: 'pending' })
    .returning()
  return row
}

/** Fetch a deletion request by confirmation code, or null if unknown. */
export async function getDeletionRequest(
  confirmationCode: string,
  db: Db = getMigrateDb(),
): Promise<MetaDataDeletionRequest | null> {
  const [row] = await db
    .select()
    .from(metaDataDeletionRequests)
    .where(eq(metaDataDeletionRequests.confirmationCode, confirmationCode))
    .limit(1)
  return row ?? null
}

/** Patch a deletion request's status/result fields. */
export async function updateDeletionRequest(
  confirmationCode: string,
  patch: {
    status?: 'pending' | 'completed' | 'failed'
    deletedAccounts?: number
    error?: string | null
    completedAt?: Date
  },
  db: Db = getMigrateDb(),
): Promise<void> {
  await db
    .update(metaDataDeletionRequests)
    .set({
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.deletedAccounts !== undefined && {
        deletedAccounts: patch.deletedAccounts,
      }),
      ...(patch.error !== undefined && { error: patch.error }),
      ...(patch.completedAt !== undefined && { completedAt: patch.completedAt }),
      updatedAt: new Date(),
    })
    .where(eq(metaDataDeletionRequests.confirmationCode, confirmationCode))
}

/**
 * Delete every Instagram inbox account connected by this Meta app-scoped user
 * id, across all tenants. Conversations and messages cascade via FK
 * (onDelete: 'cascade'). Returns the number of accounts deleted.
 */
export async function deleteInstagramDataForMetaUser(
  metaUserId: string,
  db: Db = getMigrateDb(),
): Promise<number> {
  const deleted = await db
    .delete(instagramAccounts)
    .where(eq(instagramAccounts.metaUserId, metaUserId))
    .returning({ id: instagramAccounts.id })
  return deleted.length
}
