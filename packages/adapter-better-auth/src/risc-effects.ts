import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { users, accounts, sessions } from '@vibesboard/adapter-postgres/schema'

type Db = PostgresJsDatabase<typeof schema>

// Better Auth stores Google social identities in `accounts` with
// provider_id='google' and account_id=<google sub>. Older rows may use
// 'google.com'; match both.
const GOOGLE_PROVIDER_IDS = ['google', 'google.com']

/** Resolve a Google OAuth subject (`sub`) to our internal user id, or null. */
export async function resolveUserIdByGoogleSub(
  sub: string,
  db: Db = getMigrateDb(),
): Promise<string | null> {
  const rows = await db
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(and(eq(accounts.accountId, sub), inArray(accounts.providerId, GOOGLE_PROVIDER_IDS)))
    .limit(1)
  return rows[0]?.userId ?? null
}

/** Delete all Better Auth sessions for a user (logs them out everywhere). */
export async function revokeUserSessions(
  userId: string,
  db: Db = getMigrateDb(),
): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId))
}

/** Set the user's disabled flag. */
export async function setUserDisabled(
  userId: string,
  disabled: boolean,
  db: Db = getMigrateDb(),
): Promise<void> {
  await db.update(users).set({ disabled, updatedAt: new Date() }).where(eq(users.id, userId))
}
