import { adminDb } from '@/lib/firebase/admin'
import {
  Collections,
  type WhatsAppBusinessAccountDocument,
  type BusinessAccountStatus,
} from '@/lib/firestore-types'
import CryptoJS from 'crypto-js'

/**
 * WhatsApp Business Account Management
 *
 * Handles tenant-specific WhatsApp Business Account connections:
 * - Connect/disconnect accounts
 * - Token encryption/decryption
 * - Account status synchronization with Meta
 * - List tenant accounts
 */

// =====================================================
// Types & Interfaces
// =====================================================

export interface ConnectAccountParams {
  tenantId: string
  phoneNumberId: string
  businessAccountId: string
  accessToken: string
  displayName?: string
  userId: string
}

export type WhatsAppBusinessAccount = WhatsAppBusinessAccountDocument

export interface MetaPhoneNumberInfo {
  display_phone_number: string
  verified_name: string
  quality_rating: string
  code_verification_status?: string
  id: string
}

// =====================================================
// Token Encryption/Decryption
// =====================================================

/**
 * Encrypt access token before storing in database
 * Uses AES encryption with ENCRYPTION_KEY environment variable
 */
function encryptToken(token: string): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set')
  }
  return CryptoJS.AES.encrypt(token, key).toString()
}

/**
 * Decrypt access token for API calls
 * Uses AES decryption with ENCRYPTION_KEY environment variable
 */
export function decryptToken(encryptedToken: string): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set')
  }
  const bytes = CryptoJS.AES.decrypt(encryptedToken, key)
  return bytes.toString(CryptoJS.enc.Utf8)
}

// =====================================================
// Meta Graph API Integration
// =====================================================

/**
 * Verify phone number exists in Meta Graph API
 * Fetches phone number details including quality rating and verification status
 */
async function verifyPhoneNumberWithMeta(
  phoneNumberId: string,
  accessToken: string
): Promise<MetaPhoneNumberInfo> {
  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}`

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(
      `Meta API Error: ${error.error?.message || 'Unknown error'} (Code: ${error.error?.code || 'N/A'})`
    )
  }

  const data = await response.json()

  return {
    display_phone_number: data.display_phone_number,
    verified_name: data.verified_name,
    quality_rating: data.quality_rating || 'UNKNOWN',
    code_verification_status: data.code_verification_status,
    id: data.id,
  }
}

// =====================================================
// Business Account Operations
// =====================================================

/**
 * Connect a WhatsApp Business Account to a tenant
 *
 * Steps:
 * 1. Verify phone number exists in Meta
 * 2. Encrypt access token
 * 3. Insert into database
 *
 * @throws Error if Meta verification fails or database insert fails
 */
export async function connectWhatsAppBusinessAccount(
  params: ConnectAccountParams
): Promise<WhatsAppBusinessAccount> {
  const collRef = adminDb.collection(
    Collections.whatsappBusinessAccounts(params.tenantId)
  )

  // 1. Verify the phone number exists in Meta
  const phoneInfo = await verifyPhoneNumberWithMeta(
    params.phoneNumberId,
    params.accessToken
  )

  // 2. Check for duplicate phone number
  const existingSnap = await collRef
    .where('phoneNumberId', '==', params.phoneNumberId)
    .limit(1)
    .get()

  if (!existingSnap.empty) {
    throw new Error(
      'A WhatsApp Business account with this phone number is already connected to this tenant.'
    )
  }

  // 3. Encrypt the access token
  const encryptedToken = encryptToken(params.accessToken)

  // 4. Insert into database
  const now = new Date().toISOString()
  const docRef = collRef.doc()
  const account: WhatsAppBusinessAccount = {
    id: docRef.id,
    tenantId: params.tenantId,
    phoneNumberId: params.phoneNumberId,
    businessAccountId: params.businessAccountId,
    accessToken: encryptedToken,
    phoneNumber: phoneInfo.display_phone_number,
    phoneNumberNormalized: phoneInfo.display_phone_number.replace(/\D/g, ''),
    displayName: params.displayName || phoneInfo.verified_name,
    status: 'pending',
    qualityRating: phoneInfo.quality_rating as WhatsAppBusinessAccount['qualityRating'],
    timezone: 'UTC',
    webhookVerified: false,
    createdAt: now,
    updatedAt: now,
  }

  await docRef.set(account)

  return account
}

/**
 * Sync account status from Meta
 * Updates quality rating, messaging limits, and verification status
 */
export async function syncAccountStatus(
  tenantId: string,
  accountId: string
): Promise<void> {
  const docRef = adminDb
    .collection(Collections.whatsappBusinessAccounts(tenantId))
    .doc(accountId)

  // 1. Get account
  const snap = await docRef.get()
  if (!snap.exists) {
    throw new Error('Account not found')
  }

  const account = snap.data() as WhatsAppBusinessAccount

  // 2. Decrypt token
  const accessToken = decryptToken(account.accessToken)

  // 3. Fetch from Meta
  const phoneInfo = await verifyPhoneNumberWithMeta(
    account.phoneNumberId,
    accessToken
  )

  // 4. Update database
  await docRef.update({
    qualityRating: phoneInfo.quality_rating,
    status: 'verified',
    verifiedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

/**
 * List business accounts for a tenant
 * Returns all accounts ordered by creation date (newest first)
 */
export async function listBusinessAccounts(
  tenantId: string
): Promise<WhatsAppBusinessAccount[]> {
  const snap = await adminDb
    .collection(Collections.whatsappBusinessAccounts(tenantId))
    .orderBy('createdAt', 'desc')
    .get()

  return snap.docs.map(doc => doc.data() as WhatsAppBusinessAccount)
}

/**
 * Get a single business account by ID
 */
export async function getBusinessAccountById(
  tenantId: string,
  accountId: string
): Promise<WhatsAppBusinessAccount | null> {
  const snap = await adminDb
    .collection(Collections.whatsappBusinessAccounts(tenantId))
    .doc(accountId)
    .get()

  if (!snap.exists) {
    return null
  }

  return snap.data() as WhatsAppBusinessAccount
}

/**
 * Disconnect a WhatsApp Business Account
 * Sets status to 'disconnected' but preserves data for historical records
 */
export async function disconnectBusinessAccount(
  tenantId: string,
  accountId: string
): Promise<void> {
  await adminDb
    .collection(Collections.whatsappBusinessAccounts(tenantId))
    .doc(accountId)
    .update({
      status: 'disconnected',
      updatedAt: new Date().toISOString(),
    })
}

/**
 * Update account display name
 */
export async function updateAccountDisplayName(
  tenantId: string,
  accountId: string,
  displayName: string
): Promise<void> {
  await adminDb
    .collection(Collections.whatsappBusinessAccounts(tenantId))
    .doc(accountId)
    .update({
      displayName,
      updatedAt: new Date().toISOString(),
    })
}

/**
 * Check if tenant has any active WhatsApp Business accounts
 */
export async function hasActiveAccount(tenantId: string): Promise<boolean> {
  const snap = await adminDb
    .collection(Collections.whatsappBusinessAccounts(tenantId))
    .where('status', 'in', ['pending', 'verified'])
    .limit(1)
    .get()

  return !snap.empty
}

/**
 * Get account with decrypted token (for internal use only)
 * Used by queue processor and webhook handlers
 */
export async function getAccountWithToken(
  tenantId: string,
  accountId: string
): Promise<{ account: WhatsAppBusinessAccount; accessToken: string }> {
  const account = await getBusinessAccountById(tenantId, accountId)

  if (!account) {
    throw new Error('Account not found')
  }

  if (account.status === 'disconnected') {
    throw new Error('Account is disconnected')
  }

  const accessToken = decryptToken(account.accessToken)

  return { account, accessToken }
}
