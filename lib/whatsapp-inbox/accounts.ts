import { adminDb } from '@/lib/firebase/admin'
import {
  Collections,
  type WhatsAppInboxAccountDocument,
} from '@/lib/firestore-types'
import CryptoJS from 'crypto-js'
import type {
  ConnectOAuthParams,
  ConnectApiKeyParams,
  ConnectByoaParams,
  PhoneNumberInfo,
  MetaTokenResponse,
  MetaDebugTokenData,
} from './types'

const META_GRAPH_API = 'https://graph.facebook.com/v21.0'

// =====================================================
// Token Encryption/Decryption
// =====================================================

function encryptToken(token: string): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set')
  }
  return CryptoJS.AES.encrypt(token, key).toString()
}

export function decryptToken(encryptedToken: string): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set')
  }
  const bytes = CryptoJS.AES.decrypt(encryptedToken, key)
  return bytes.toString(CryptoJS.enc.Utf8)
}

// =====================================================
// Meta Graph API — OAuth Token Exchange
// =====================================================

/**
 * Exchange an authorization code for a short-lived user access token.
 * This is step 1 of the OAuth flow after the user completes FB.login().
 */
export async function exchangeCodeForToken(
  code: string
): Promise<MetaTokenResponse> {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID
  const appSecret = process.env.META_APP_SECRET

  if (!appId || !appSecret) {
    throw new Error('META_APP_ID or META_APP_SECRET environment variables not set')
  }

  const url = new URL(`${META_GRAPH_API}/oauth/access_token`)
  url.searchParams.set('client_id', appId)
  url.searchParams.set('client_secret', appSecret)
  url.searchParams.set('code', code)

  const response = await fetch(url.toString())

  if (!response.ok) {
    const error = await response.json()
    throw new Error(
      `Token exchange failed: ${error.error?.message || 'Unknown error'}`
    )
  }

  return response.json()
}

/**
 * Debug the user token to extract WABA ID from granular scopes.
 */
export async function getWABAFromToken(
  userToken: string
): Promise<{ wabaId: string }> {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID
  const appSecret = process.env.META_APP_SECRET

  const response = await fetch(
    `${META_GRAPH_API}/debug_token?input_token=${userToken}`,
    {
      headers: {
        Authorization: `Bearer ${appId}|${appSecret}`,
      },
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(
      `Token debug failed: ${error.error?.message || 'Unknown error'}`
    )
  }

  const { data } = (await response.json()) as { data: MetaDebugTokenData }

  // Extract WABA ID from granular scopes
  const messagingScope = data.granular_scopes?.find(
    (s) => s.scope === 'whatsapp_business_messaging'
  )
  const wabaId = messagingScope?.target_ids?.[0]

  if (!wabaId) {
    throw new Error(
      'No WhatsApp Business Account found in authorized scopes. ' +
        'Ensure the user selected a WABA during the signup flow.'
    )
  }

  return { wabaId }
}

/**
 * Subscribe our app to the WABA's webhooks so we receive messages.
 */
export async function subscribeToWebhooks(
  wabaId: string,
  accessToken: string
): Promise<void> {
  const response = await fetch(
    `${META_GRAPH_API}/${wabaId}/subscribed_apps`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(
      `Webhook subscription failed: ${error.error?.message || 'Unknown error'}`
    )
  }
}

/**
 * Get phone numbers associated with a WABA.
 */
export async function getPhoneNumbers(
  wabaId: string,
  accessToken: string
): Promise<PhoneNumberInfo[]> {
  const response = await fetch(
    `${META_GRAPH_API}/${wabaId}/phone_numbers`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(
      `Failed to get phone numbers: ${error.error?.message || 'Unknown error'}`
    )
  }

  const data = await response.json()
  return data.data || []
}

// =====================================================
// Account Operations
// =====================================================

/**
 * Full OAuth account connection flow:
 * 1. Exchange authorization code for user token
 * 2. Debug token to get WABA ID
 * 3. Subscribe to webhooks
 * 4. Get phone numbers
 * 5. Encrypt token and store in Firestore
 */
export async function connectOAuthAccount(
  params: ConnectOAuthParams
): Promise<WhatsAppInboxAccountDocument> {
  // 1. Exchange code for user access token
  const { access_token: userToken } = await exchangeCodeForToken(params.code)

  // 2. Get WABA ID from token
  const { wabaId } = await getWABAFromToken(userToken)

  // 3. Subscribe our app to the WABA webhooks
  await subscribeToWebhooks(wabaId, userToken)

  // 4. Get phone numbers on this WABA
  const phones = await getPhoneNumbers(wabaId, userToken)
  if (phones.length === 0) {
    throw new Error(
      'No phone numbers found on the WhatsApp Business Account. ' +
        'Please add a phone number in Meta Business Suite first.'
    )
  }

  const phone = phones[0] // Use first phone number

  // 5. Check for duplicate WABA
  const collRef = adminDb.collection(
    Collections.whatsappInboxAccounts(params.tenantId)
  )
  const existingSnap = await collRef
    .where('wabaId', '==', wabaId)
    .where('status', '==', 'active')
    .limit(1)
    .get()

  if (!existingSnap.empty) {
    throw new Error(
      'This WhatsApp Business Account is already connected to your workspace.'
    )
  }

  // 6. Encrypt token and store
  const now = new Date().toISOString()
  const docRef = collRef.doc()
  const account: WhatsAppInboxAccountDocument = {
    id: docRef.id,
    tenantId: params.tenantId,
    wabaId,
    phoneNumberId: phone.id,
    displayPhoneNumber: phone.display_phone_number,
    businessName: phone.verified_name,
    accessToken: encryptToken(userToken),
    scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
    status: 'active',
    connectedBy: params.userId,
    connectedAt: now,
    connectionMethod: 'oauth',
    webhookSubscribed: true,
    createdAt: now,
    updatedAt: now,
  }

  await docRef.set(account)

  return account
}

/**
 * Connect a WhatsApp Business Account using a System User access token.
 * Validates the token by fetching phone numbers, subscribes to webhooks,
 * then encrypts and stores the account.
 */
export async function connectApiKeyAccount(
  params: ConnectApiKeyParams
): Promise<WhatsAppInboxAccountDocument> {
  const { tenantId, accessToken, wabaId, userId } = params

  // 1. Validate token by fetching phone numbers for this WABA
  const phones = await getPhoneNumbers(wabaId, accessToken)
  if (phones.length === 0) {
    throw new Error(
      'No phone numbers found on the WhatsApp Business Account. ' +
        'Please verify your WABA ID and access token.'
    )
  }
  const phone = phones[0]

  // 2. Check for duplicate WABA
  const collRef = adminDb.collection(
    Collections.whatsappInboxAccounts(tenantId)
  )
  const existingSnap = await collRef
    .where('wabaId', '==', wabaId)
    .where('status', '==', 'active')
    .limit(1)
    .get()

  if (!existingSnap.empty) {
    throw new Error(
      'This WhatsApp Business Account is already connected to your workspace.'
    )
  }

  // 3. Subscribe to webhooks
  await subscribeToWebhooks(wabaId, accessToken)

  // 4. Encrypt token and store
  const now = new Date().toISOString()
  const docRef = collRef.doc()
  const account: WhatsAppInboxAccountDocument = {
    id: docRef.id,
    tenantId,
    wabaId,
    phoneNumberId: phone.id,
    displayPhoneNumber: phone.display_phone_number,
    businessName: phone.verified_name,
    accessToken: encryptToken(accessToken),
    scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
    status: 'active',
    connectedBy: userId,
    connectedAt: now,
    connectionMethod: 'api_key',
    webhookSubscribed: true,
    createdAt: now,
    updatedAt: now,
  }

  await docRef.set(account)
  return account
}

/**
 * Connect a WhatsApp Business Account using customer's own Meta App (BYOA).
 * Customer provides their own App ID, App Secret, access token, and webhook verify token.
 * Webhook subscription is NOT done — customer configures their own Meta App webhooks.
 */
export async function connectByoaAccount(
  params: ConnectByoaParams
): Promise<WhatsAppInboxAccountDocument> {
  const { tenantId, metaAppId, metaAppSecret, accessToken, webhookVerifyToken, wabaId, userId } = params

  // 1. Validate token by fetching phone numbers for this WABA
  const phones = await getPhoneNumbers(wabaId, accessToken)
  if (phones.length === 0) {
    throw new Error(
      'No phone numbers found on the WhatsApp Business Account. ' +
        'Please verify your WABA ID and access token.'
    )
  }
  const phone = phones[0]

  // 2. Check for duplicate WABA
  const collRef = adminDb.collection(
    Collections.whatsappInboxAccounts(tenantId)
  )
  const existingSnap = await collRef
    .where('wabaId', '==', wabaId)
    .where('status', '==', 'active')
    .limit(1)
    .get()

  if (!existingSnap.empty) {
    throw new Error(
      'This WhatsApp Business Account is already connected to your workspace.'
    )
  }

  // 3. Generate document and webhook URL
  const docRef = collRef.doc()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const byoaWebhookUrl = `${appUrl}/api/webhooks/whatsapp-inbox/byoa/${docRef.id}`

  // 4. Encrypt secrets and store
  const now = new Date().toISOString()
  const account: WhatsAppInboxAccountDocument = {
    id: docRef.id,
    tenantId,
    wabaId,
    phoneNumberId: phone.id,
    displayPhoneNumber: phone.display_phone_number,
    businessName: phone.verified_name,
    accessToken: encryptToken(accessToken),
    scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
    status: 'active',
    connectedBy: userId,
    connectedAt: now,
    connectionMethod: 'byoa',
    metaAppId,
    metaAppSecret: encryptToken(metaAppSecret),
    webhookVerifyToken: encryptToken(webhookVerifyToken),
    byoaWebhookUrl,
    webhookSubscribed: false, // customer manages their own webhook subscriptions
    createdAt: now,
    updatedAt: now,
  }

  await docRef.set(account)
  return account
}

/**
 * Find a BYOA account by document ID (for per-account webhook routing).
 * Uses collectionGroup query to search across all tenants.
 */
export async function findByoaAccountById(
  accountId: string
): Promise<{ account: WhatsAppInboxAccountDocument; tenantId: string } | null> {
  const snap = await adminDb
    .collectionGroup('whatsapp_inbox_accounts')
    .where('id', '==', accountId)
    .where('connectionMethod', '==', 'byoa')
    .where('status', '==', 'active')
    .limit(1)
    .get()

  if (snap.empty) return null

  const doc = snap.docs[0]!
  const account = doc.data() as WhatsAppInboxAccountDocument
  const tenantId = doc.ref.path.split('/')[1]

  return { account, tenantId }
}

/**
 * List inbox accounts for a tenant.
 */
export async function listInboxAccounts(
  tenantId: string
): Promise<WhatsAppInboxAccountDocument[]> {
  const snap = await adminDb
    .collection(Collections.whatsappInboxAccounts(tenantId))
    .orderBy('createdAt', 'desc')
    .get()

  return snap.docs.map((d: any) => d.data() as WhatsAppInboxAccountDocument)
}

/**
 * Get a single inbox account.
 */
export async function getInboxAccount(
  tenantId: string,
  accountId: string
): Promise<WhatsAppInboxAccountDocument | null> {
  const snap = await adminDb
    .collection(Collections.whatsappInboxAccounts(tenantId))
    .doc(accountId)
    .get()

  return snap.exists
    ? (snap.data() as WhatsAppInboxAccountDocument)
    : null
}

/**
 * Disconnect an inbox account (soft delete).
 */
export async function disconnectInboxAccount(
  tenantId: string,
  accountId: string
): Promise<void> {
  await adminDb
    .collection(Collections.whatsappInboxAccounts(tenantId))
    .doc(accountId)
    .update({
      status: 'disconnected',
      updatedAt: new Date().toISOString(),
    })
}

/**
 * Find an inbox account by WABA ID (for webhook routing).
 * Uses collectionGroup query to search across all tenants.
 */
export async function findAccountByWabaId(
  wabaId: string
): Promise<{ account: WhatsAppInboxAccountDocument; tenantId: string } | null> {
  const snap = await adminDb
    .collectionGroup('whatsapp_inbox_accounts')
    .where('wabaId', '==', wabaId)
    .where('status', '==', 'active')
    .limit(1)
    .get()

  if (snap.empty) return null

  const doc = snap.docs[0]!
  const account = doc.data() as WhatsAppInboxAccountDocument
  // Path: tenants/{tenantId}/whatsapp_inbox_accounts/{accountId}
  const tenantId = doc.ref.path.split('/')[1]

  return { account, tenantId }
}

/**
 * Get account with decrypted token (for sending messages).
 */
export async function getAccountWithToken(
  tenantId: string,
  accountId: string
): Promise<{ account: WhatsAppInboxAccountDocument; accessToken: string }> {
  const account = await getInboxAccount(tenantId, accountId)

  if (!account) {
    throw new Error('Inbox account not found')
  }

  if (account.status !== 'active') {
    throw new Error('Inbox account is not active')
  }

  const accessToken = decryptToken(account.accessToken)
  return { account, accessToken }
}
