import { and, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { dataConnections } from '@vibesboard/adapter-postgres/schema'
import {
  type DataConnectionDocument,
  type DataConnectionStatus
} from '@vibesboard/contracts'
import { decryptToken } from '@vibesboard/scheduling/connections'
import { refreshAccessToken } from './google-sheets-auth.ts'
import { rowToDataConnection } from './db.ts'
import { sealSecret } from '@vibesboard/utils/secret-box'

type Db = PostgresJsDatabase<typeof schema>

// ─── Token Encryption ───────────────────────────────────────────────

// Authenticated (AES-256-GCM) encryption. Decryption reuses scheduling's
// decryptToken (imported above), which now also delegates to secret-box.
function encryptToken(token: string): string {
  return sealSecret(token)
}

/**
 * Encrypt custom-webhook header VALUES at rest — they commonly carry an
 * Authorization credential. Names are left in cleartext so connections stay
 * debuggable. Decrypted at the point of use in providers/index.ts.
 */
export function encryptHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!headers) return headers
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k, sealSecret(v)])
  )
}

// ─── Create Params ──────────────────────────────────────────────────

export interface CreateGoogleSheetsConnectionParams {
  tenantId: string
  accessToken: string
  refreshToken: string
  tokenExpiresAt: string
  email?: string
  spreadsheetId: string
  sheetName?: string
  scopes: string[]
  connectedBy: string
  name: string
}

export interface CreateAirtableConnectionParams {
  tenantId: string
  apiToken: string
  baseId: string
  tableId: string
  tableName?: string
  connectedBy: string
  name: string
}

export interface CreateWebhookConnectionParams {
  tenantId: string
  webhookUrl: string
  webhookMethod?: 'POST' | 'PUT'
  webhookHeaders?: Record<string, string>
  connectedBy: string
  name: string
}

export type CreateDataConnectionParams =
  | ({ provider: 'google_sheets' } & CreateGoogleSheetsConnectionParams)
  | ({ provider: 'airtable' } & CreateAirtableConnectionParams)
  | ({ provider: 'custom_webhook' } & CreateWebhookConnectionParams)

// ─── CRUD ───────────────────────────────────────────────────────────

function buildConnectionValues(params: CreateDataConnectionParams) {
  switch (params.provider) {
    case 'google_sheets':
      return {
        accessTokenEncrypted: encryptToken(params.accessToken),
        refreshTokenEncrypted: encryptToken(params.refreshToken),
        tokenExpiresAt: new Date(params.tokenExpiresAt),
        email: params.email ?? null,
        spreadsheetId: params.spreadsheetId,
        sheetName: params.sheetName ?? 'Sheet1',
        scopes: params.scopes
      }
    case 'airtable':
      return {
        apiTokenEncrypted: encryptToken(params.apiToken),
        baseId: params.baseId,
        tableId: params.tableId,
        tableName: params.tableName ?? null
      }
    case 'custom_webhook':
      return {
        webhookUrl: params.webhookUrl,
        webhookMethod: params.webhookMethod ?? 'POST',
        webhookHeaders: encryptHeaders(params.webhookHeaders) ?? null
      }
  }
}

export async function createDataConnection(
  params: CreateDataConnectionParams,
  db: Db = getMigrateDb()
): Promise<DataConnectionDocument> {
  const [row] = await db
    .insert(dataConnections)
    .values({
      id: uuidv7(),
      tenantId: params.tenantId,
      provider: params.provider,
      name: params.name,
      status: 'active',
      connectedBy: params.connectedBy,
      ...buildConnectionValues(params)
    })
    .returning()
  return rowToDataConnection(row)
}

export async function getDataConnections(
  tenantId: string,
  db: Db = getMigrateDb()
): Promise<DataConnectionDocument[]> {
  const rows = await db
    .select()
    .from(dataConnections)
    .where(eq(dataConnections.tenantId, tenantId))
  return rows.map(rowToDataConnection)
}

export async function getDataConnection(
  tenantId: string,
  connectionId: string,
  db: Db = getMigrateDb()
): Promise<DataConnectionDocument | null> {
  const [row] = await db
    .select()
    .from(dataConnections)
    .where(
      and(
        eq(dataConnections.tenantId, tenantId),
        eq(dataConnections.id, connectionId)
      )
    )
    .limit(1)
  return row ? rowToDataConnection(row) : null
}

export async function deleteDataConnection(
  tenantId: string,
  connectionId: string,
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .delete(dataConnections)
    .where(
      and(
        eq(dataConnections.tenantId, tenantId),
        eq(dataConnections.id, connectionId)
      )
    )
}

export async function updateDataConnectionStatus(
  tenantId: string,
  connectionId: string,
  status: DataConnectionStatus,
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .update(dataConnections)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(dataConnections.tenantId, tenantId),
        eq(dataConnections.id, connectionId)
      )
    )
}

export async function updateDataConnection(
  tenantId: string,
  connectionId: string,
  updates: Partial<
    Pick<
      DataConnectionDocument,
      | 'name'
      | 'sheetName'
      | 'spreadsheetId'
      | 'tableId'
      | 'tableName'
      | 'webhookUrl'
      | 'webhookMethod'
      | 'webhookHeaders'
    >
  >,
  db: Db = getMigrateDb()
): Promise<void> {
  // Re-encrypt header values on update, same as on create.
  const safeUpdates =
    updates.webhookHeaders !== undefined
      ? { ...updates, webhookHeaders: encryptHeaders(updates.webhookHeaders) }
      : updates
  await db
    .update(dataConnections)
    .set({ ...safeUpdates, updatedAt: new Date() })
    .where(
      and(
        eq(dataConnections.tenantId, tenantId),
        eq(dataConnections.id, connectionId)
      )
    )
}

// ─── Token Management ───────────────────────────────────────────────

/**
 * Get a valid access token for a data connection.
 * - Google Sheets: auto-refreshes expired OAuth tokens
 * - Airtable: decrypts and returns the personal access token
 * - Webhook: returns empty string (not token-based)
 */
export async function getValidDataAccessToken(
  connection: DataConnectionDocument,
  db: Db = getMigrateDb()
): Promise<string> {
  switch (connection.provider) {
    case 'google_sheets': {
      const now = Date.now()
      const expiresAt = new Date(connection.tokenExpiresAt!).getTime()

      // 60s buffer to avoid edge-case expiry
      if (now < expiresAt - 60_000) {
        return decryptToken(connection.accessToken!)
      }

      // Refresh
      const refreshToken = decryptToken(connection.refreshToken!)
      try {
        const refreshed = await refreshAccessToken(refreshToken)
        await db
          .update(dataConnections)
          .set({
            accessTokenEncrypted: encryptToken(refreshed.accessToken),
            tokenExpiresAt: new Date(refreshed.expiresAt),
            updatedAt: new Date()
          })
          .where(
            and(
              eq(dataConnections.tenantId, connection.tenantId),
              eq(dataConnections.id, connection.id)
            )
          )
        return refreshed.accessToken
      } catch (error) {
        await updateDataConnectionStatus(
          connection.tenantId,
          connection.id,
          'expired',
          db
        )
        throw new Error(
          `Google Sheets token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    }

    case 'airtable':
      return decryptToken(connection.apiToken!)

    case 'custom_webhook':
      return ''

    default:
      throw new Error(`Unknown data provider: ${connection.provider}`)
  }
}
