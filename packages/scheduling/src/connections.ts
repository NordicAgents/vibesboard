import { and, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { calendarConnections } from '@vibesboard/adapter-postgres/schema'
import {
  type CalendarConnectionDocument,
  type CalendarProvider,
  type CalendarConnectionStatus
} from '@vibesboard/contracts'
import { refreshAccessToken } from './google-auth.ts'
import { rowToCalendarConnection } from './db.ts'
import { sealSecret, unsealSecret } from '@vibesboard/utils/secret-box'

type Db = PostgresJsDatabase<typeof schema>

// ─── Token Encryption ───────────────────────────────────────────────

// Authenticated (AES-256-GCM) encryption with key rotation and transparent
// decryption of legacy CryptoJS ciphertext — see @vibesboard/utils/secret-box.
function encryptToken(token: string): string {
  return sealSecret(token)
}

export function decryptToken(encryptedToken: string): string {
  return unsealSecret(encryptedToken)
}

// ─── CRUD ───────────────────────────────────────────────────────────

export interface CreateConnectionParams {
  tenantId: string
  provider: CalendarProvider
  name: string
  calendarId: string
  accessToken: string
  refreshToken: string
  tokenExpiresAt: string
  email?: string
  scopes: string[]
  connectedBy: string
}

export async function createCalendarConnection(
  params: CreateConnectionParams,
  db: Db = getMigrateDb()
): Promise<CalendarConnectionDocument> {
  const id = uuidv7()
  const [row] = await db
    .insert(calendarConnections)
    .values({
      id,
      tenantId: params.tenantId,
      provider: params.provider,
      name: params.name,
      calendarId: params.calendarId,
      accessTokenEncrypted: encryptToken(params.accessToken),
      refreshTokenEncrypted: encryptToken(params.refreshToken),
      tokenExpiresAt: new Date(params.tokenExpiresAt),
      email: params.email ?? null,
      scopes: params.scopes,
      status: 'active',
      connectedBy: params.connectedBy
    })
    .returning()
  return rowToCalendarConnection(row)
}

export async function getCalendarConnections(
  tenantId: string,
  db: Db = getMigrateDb()
): Promise<CalendarConnectionDocument[]> {
  const rows = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.tenantId, tenantId))
  return rows.map(rowToCalendarConnection)
}

export async function getCalendarConnection(
  tenantId: string,
  connectionId: string,
  db: Db = getMigrateDb()
): Promise<CalendarConnectionDocument | null> {
  const [row] = await db
    .select()
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.tenantId, tenantId),
        eq(calendarConnections.id, connectionId)
      )
    )
    .limit(1)
  return row ? rowToCalendarConnection(row) : null
}

export async function deleteCalendarConnection(
  tenantId: string,
  connectionId: string,
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .delete(calendarConnections)
    .where(
      and(
        eq(calendarConnections.tenantId, tenantId),
        eq(calendarConnections.id, connectionId)
      )
    )
}

export async function updateConnectionStatus(
  tenantId: string,
  connectionId: string,
  status: CalendarConnectionStatus,
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .update(calendarConnections)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(calendarConnections.tenantId, tenantId),
        eq(calendarConnections.id, connectionId)
      )
    )
}

// ─── Token Management ───────────────────────────────────────────────

/**
 * Get a valid access token for a calendar connection.
 * Automatically refreshes if expired and persists the new token to Postgres.
 */
export async function getValidAccessToken(
  connection: CalendarConnectionDocument,
  db: Db = getMigrateDb()
): Promise<string> {
  const now = Date.now()
  const expiresAt = new Date(connection.tokenExpiresAt).getTime()

  // Add 60s buffer to avoid edge-case expiry during request
  if (now < expiresAt - 60_000) {
    return decryptToken(connection.accessToken)
  }

  // Token is expired or about to expire — refresh
  const refreshToken = decryptToken(connection.refreshToken)

  try {
    const refreshed = await refreshAccessToken(refreshToken)

    await db
      .update(calendarConnections)
      .set({
        accessTokenEncrypted: encryptToken(refreshed.accessToken),
        tokenExpiresAt: new Date(refreshed.expiresAt),
        updatedAt: new Date()
      })
      .where(
        and(
          eq(calendarConnections.tenantId, connection.tenantId),
          eq(calendarConnections.id, connection.id)
        )
      )

    return refreshed.accessToken
  } catch (error) {
    // Mark connection as expired if refresh fails
    await updateConnectionStatus(
      connection.tenantId,
      connection.id,
      'expired',
      db
    )
    throw new Error(
      `Calendar connection token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}
