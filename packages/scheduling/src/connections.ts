import { adminDb } from '@vibesboard/adapter-firebase/admin'
import {
  Collections,
  type CalendarConnectionDocument,
  type CalendarProvider,
  type CalendarConnectionStatus
} from '@vibesboard/contracts'
import { refreshAccessToken } from './google-auth.ts'
import CryptoJS from 'crypto-js'

// ─── Startup Validation ─────────────────────────────────────────────

// Fail fast on the server so misconfiguration is caught at boot time,
// not silently at the first token encrypt/decrypt call.
// Note: key rotation is not yet supported — all tokens are encrypted
// with the single active key. To rotate, re-encrypt all stored tokens
// with the new key before swapping the env variable.
if (typeof window === 'undefined' && !process.env.ENCRYPTION_KEY) {
  console.error(
    '[scheduling/connections] FATAL: ENCRYPTION_KEY environment variable is not set. ' +
      'Calendar OAuth tokens cannot be encrypted or decrypted. ' +
      'Set ENCRYPTION_KEY before deploying.'
  )
}

// ─── Token Encryption ───────────────────────────────────────────────

function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is not set. ' +
        'Calendar OAuth tokens cannot be encrypted or decrypted.'
    )
  }
  return key
}

function encryptToken(token: string): string {
  return CryptoJS.AES.encrypt(token, getEncryptionKey()).toString()
}

export function decryptToken(encryptedToken: string): string {
  const bytes = CryptoJS.AES.decrypt(encryptedToken, getEncryptionKey())
  return bytes.toString(CryptoJS.enc.Utf8)
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
  params: CreateConnectionParams
): Promise<CalendarConnectionDocument> {
  const collPath = Collections.calendarConnections(params.tenantId)
  const docRef = adminDb.collection(collPath).doc()
  const now = new Date().toISOString()

  const doc: CalendarConnectionDocument = {
    id: docRef.id,
    tenantId: params.tenantId,
    provider: params.provider,
    name: params.name,
    calendarId: params.calendarId,
    accessToken: encryptToken(params.accessToken),
    refreshToken: encryptToken(params.refreshToken),
    tokenExpiresAt: params.tokenExpiresAt,
    email: params.email,
    scopes: params.scopes,
    status: 'active',
    connectedBy: params.connectedBy,
    connectedAt: now,
    createdAt: now,
    updatedAt: now
  }

  await docRef.set(doc)
  return doc
}

export async function getCalendarConnections(
  tenantId: string
): Promise<CalendarConnectionDocument[]> {
  const collPath = Collections.calendarConnections(tenantId)
  const snapshot = await adminDb.collection(collPath).get()
  return snapshot.docs.map(
    (d: FirebaseFirestore.QueryDocumentSnapshot) =>
      ({ id: d.id, ...d.data() }) as CalendarConnectionDocument
  )
}

export async function getCalendarConnection(
  tenantId: string,
  connectionId: string
): Promise<CalendarConnectionDocument | null> {
  const collPath = Collections.calendarConnections(tenantId)
  const doc = await adminDb.collection(collPath).doc(connectionId).get()
  if (!doc.exists) return null
  return { id: doc.id, ...doc.data() } as CalendarConnectionDocument
}

export async function deleteCalendarConnection(
  tenantId: string,
  connectionId: string
): Promise<void> {
  const collPath = Collections.calendarConnections(tenantId)
  await adminDb.collection(collPath).doc(connectionId).delete()
}

export async function updateConnectionStatus(
  tenantId: string,
  connectionId: string,
  status: CalendarConnectionStatus
): Promise<void> {
  const collPath = Collections.calendarConnections(tenantId)
  await adminDb.collection(collPath).doc(connectionId).update({
    status,
    updatedAt: new Date().toISOString()
  })
}

// ─── Token Management ───────────────────────────────────────────────

/**
 * Get a valid access token for a calendar connection.
 * Automatically refreshes if expired and updates Firestore.
 */
export async function getValidAccessToken(
  connection: CalendarConnectionDocument
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

    // Update Firestore with new tokens
    const collPath = Collections.calendarConnections(connection.tenantId)
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
    // Mark connection as expired if refresh fails
    await updateConnectionStatus(connection.tenantId, connection.id, 'expired')
    throw new Error(
      `Calendar connection token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}
