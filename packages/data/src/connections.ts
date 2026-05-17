import { adminDb } from '@vibesboard/adapter-firebase/admin'
import {
  Collections,
  type DataConnectionDocument,
  type DataConnectionStatus,
  type DataProvider
} from '@vibesboard/contracts'
import { decryptToken } from '@vibesboard/scheduling/connections'
import { refreshAccessToken } from './google-sheets-auth.ts'
import CryptoJS from 'crypto-js'

// ─── Token Encryption ───────────────────────────────────────────────

function encryptToken(token: string): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY environment variable is not set')
  return CryptoJS.AES.encrypt(token, key).toString()
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

// ─── CRUD ───────────────────────────────────────────────────────────

export async function createDataConnection(
  params:
    | ({ provider: 'google_sheets' } & CreateGoogleSheetsConnectionParams)
    | ({ provider: 'airtable' } & CreateAirtableConnectionParams)
    | ({ provider: 'custom_webhook' } & CreateWebhookConnectionParams)
): Promise<DataConnectionDocument> {
  const collPath = Collections.dataConnections(params.tenantId)
  const docRef = adminDb.collection(collPath).doc()
  const now = new Date().toISOString()

  const base: Pick<
    DataConnectionDocument,
    | 'id'
    | 'tenantId'
    | 'provider'
    | 'name'
    | 'status'
    | 'connectedBy'
    | 'connectedAt'
    | 'createdAt'
    | 'updatedAt'
  > = {
    id: docRef.id,
    tenantId: params.tenantId,
    provider: params.provider,
    name: params.name,
    status: 'active',
    connectedBy: params.connectedBy,
    connectedAt: now,
    createdAt: now,
    updatedAt: now
  }

  let doc: DataConnectionDocument

  switch (params.provider) {
    case 'google_sheets':
      doc = {
        ...base,
        accessToken: encryptToken(params.accessToken),
        refreshToken: encryptToken(params.refreshToken),
        tokenExpiresAt: params.tokenExpiresAt,
        email: params.email,
        spreadsheetId: params.spreadsheetId,
        sheetName: params.sheetName ?? 'Sheet1',
        scopes: params.scopes
      }
      break

    case 'airtable':
      doc = {
        ...base,
        apiToken: encryptToken(params.apiToken),
        baseId: params.baseId,
        tableId: params.tableId,
        tableName: params.tableName
      }
      break

    case 'custom_webhook':
      doc = {
        ...base,
        webhookUrl: params.webhookUrl,
        webhookMethod: params.webhookMethod ?? 'POST',
        webhookHeaders: params.webhookHeaders
      }
      break
  }

  await docRef.set(doc)
  return doc
}

export async function getDataConnections(
  tenantId: string
): Promise<DataConnectionDocument[]> {
  const collPath = Collections.dataConnections(tenantId)
  const snapshot = await adminDb.collection(collPath).get()
  return snapshot.docs.map(
    (d: FirebaseFirestore.QueryDocumentSnapshot) =>
      ({ id: d.id, ...d.data() }) as DataConnectionDocument
  )
}

export async function getDataConnection(
  tenantId: string,
  connectionId: string
): Promise<DataConnectionDocument | null> {
  const collPath = Collections.dataConnections(tenantId)
  const doc = await adminDb.collection(collPath).doc(connectionId).get()
  if (!doc.exists) return null
  return { id: doc.id, ...doc.data() } as DataConnectionDocument
}

export async function deleteDataConnection(
  tenantId: string,
  connectionId: string
): Promise<void> {
  const collPath = Collections.dataConnections(tenantId)
  await adminDb.collection(collPath).doc(connectionId).delete()
}

export async function updateDataConnectionStatus(
  tenantId: string,
  connectionId: string,
  status: DataConnectionStatus
): Promise<void> {
  const collPath = Collections.dataConnections(tenantId)
  await adminDb.collection(collPath).doc(connectionId).update({
    status,
    updatedAt: new Date().toISOString()
  })
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
  >
): Promise<void> {
  const collPath = Collections.dataConnections(tenantId)
  await adminDb
    .collection(collPath)
    .doc(connectionId)
    .update({
      ...updates,
      updatedAt: new Date().toISOString()
    })
}

// ─── Token Management ───────────────────────────────────────────────

/**
 * Get a valid access token for a data connection.
 * - Google Sheets: auto-refreshes expired OAuth tokens
 * - Airtable: decrypts and returns the personal access token
 * - Webhook: returns empty string (not token-based)
 */
export async function getValidDataAccessToken(
  connection: DataConnectionDocument
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
        const collPath = Collections.dataConnections(connection.tenantId)
        await adminDb
          .collection(collPath)
          .doc(connection.id)
          .update({
            accessToken: encryptToken(refreshed.accessToken),
            tokenExpiresAt: refreshed.expiresAt,
            updatedAt: new Date().toISOString()
          })
        return refreshed.accessToken
      } catch (error) {
        await updateDataConnectionStatus(
          connection.tenantId,
          connection.id,
          'expired'
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
