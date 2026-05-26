import { and, eq, desc } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { whatsappAccounts } from '@vibesboard/adapter-postgres/schema'
import { type WhatsAppInboxAccountDocument } from '@vibesboard/contracts'
import CryptoJS from 'crypto-js'
import { rowToWhatsappAccount } from './db.ts'
import type {
  ConnectOAuthParams,
  ConnectApiKeyParams,
  ConnectByoaParams,
  PhoneNumberInfo,
  MetaTokenResponse,
  MetaDebugTokenData
} from './types.ts'

type Db = PostgresJsDatabase<typeof schema>

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
    throw new Error(
      'META_APP_ID or META_APP_SECRET environment variables not set'
    )
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
        Authorization: `Bearer ${appId}|${appSecret}`
      }
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
    s => s.scope === 'whatsapp_business_messaging'
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
  const response = await fetch(`${META_GRAPH_API}/${wabaId}/subscribed_apps`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })

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
  const response = await fetch(`${META_GRAPH_API}/${wabaId}/phone_numbers`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })

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
// Account Operations (Postgres)
// =====================================================

export interface CreateAccountRowParams {
  tenantId: string
  wabaId: string
  phoneNumberId: string
  displayPhoneNumber: string
  businessName: string
  accessTokenEncrypted: string
  connectedBy: string
  connectionMethod: 'oauth' | 'api_key' | 'byoa'
  webhookSubscribed: boolean
  scopes: string[]
  id?: string
  metaAppId?: string
  metaAppSecretEncrypted?: string
  webhookVerifyTokenEncrypted?: string
  byoaWebhookUrl?: string
}

async function existsActiveWaba(
  db: Db,
  tenantId: string,
  wabaId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: whatsappAccounts.id })
    .from(whatsappAccounts)
    .where(
      and(
        eq(whatsappAccounts.tenantId, tenantId),
        eq(whatsappAccounts.wabaId, wabaId),
        eq(whatsappAccounts.status, 'active')
      )
    )
    .limit(1)
  return !!row
}

/**
 * Insert a WhatsApp inbox account row and return the legacy doc shape.
 */
export async function createAccountRow(
  p: CreateAccountRowParams,
  db: Db = getMigrateDb()
): Promise<WhatsAppInboxAccountDocument> {
  const id = p.id ?? uuidv7()
  const [row] = await db
    .insert(whatsappAccounts)
    .values({
      id,
      tenantId: p.tenantId,
      wabaId: p.wabaId,
      phoneNumberId: p.phoneNumberId,
      displayPhoneNumber: p.displayPhoneNumber,
      businessName: p.businessName,
      accessTokenEncrypted: p.accessTokenEncrypted,
      scopes: p.scopes,
      status: 'active',
      connectedBy: p.connectedBy,
      webhookSubscribed: p.webhookSubscribed,
      connectionMethod: p.connectionMethod,
      metaAppId: p.metaAppId ?? null,
      metaAppSecretEncrypted: p.metaAppSecretEncrypted ?? null,
      webhookVerifyTokenEncrypted: p.webhookVerifyTokenEncrypted ?? null,
      byoaWebhookUrl: p.byoaWebhookUrl ?? null
    })
    .returning()
  return rowToWhatsappAccount(row)
}

/**
 * List inbox accounts for a tenant.
 */
export async function listInboxAccounts(
  tenantId: string,
  db: Db = getMigrateDb()
): Promise<WhatsAppInboxAccountDocument[]> {
  const rows = await db
    .select()
    .from(whatsappAccounts)
    .where(eq(whatsappAccounts.tenantId, tenantId))
    .orderBy(desc(whatsappAccounts.createdAt))
  return rows.map(rowToWhatsappAccount)
}

/**
 * Get a single inbox account.
 */
export async function getInboxAccount(
  tenantId: string,
  accountId: string,
  db: Db = getMigrateDb()
): Promise<WhatsAppInboxAccountDocument | null> {
  const [row] = await db
    .select()
    .from(whatsappAccounts)
    .where(
      and(
        eq(whatsappAccounts.tenantId, tenantId),
        eq(whatsappAccounts.id, accountId)
      )
    )
    .limit(1)
  return row ? rowToWhatsappAccount(row) : null
}

/**
 * Disconnect an inbox account (soft delete).
 */
export async function disconnectInboxAccount(
  tenantId: string,
  accountId: string,
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .update(whatsappAccounts)
    .set({ status: 'disconnected', updatedAt: new Date() })
    .where(
      and(
        eq(whatsappAccounts.tenantId, tenantId),
        eq(whatsappAccounts.id, accountId)
      )
    )
}

/**
 * Update per-account agent assignment / auto-reply settings.
 */
export async function updateAccountAssignment(
  tenantId: string,
  accountId: string,
  patch: { assignedAgentId?: string | null; agentAutoReply?: boolean },
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .update(whatsappAccounts)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(whatsappAccounts.tenantId, tenantId),
        eq(whatsappAccounts.id, accountId)
      )
    )
}

/**
 * Find an active inbox account by WABA ID (for webhook routing, no tenant filter).
 */
export async function findAccountByWabaId(
  wabaId: string,
  db: Db = getMigrateDb()
): Promise<{ account: WhatsAppInboxAccountDocument; tenantId: string } | null> {
  const [row] = await db
    .select()
    .from(whatsappAccounts)
    .where(
      and(
        eq(whatsappAccounts.wabaId, wabaId),
        eq(whatsappAccounts.status, 'active')
      )
    )
    .limit(1)
  return row
    ? { account: rowToWhatsappAccount(row), tenantId: row.tenantId }
    : null
}

/**
 * Find an active BYOA account by id (for per-account webhook routing).
 */
export async function findByoaAccountById(
  accountId: string,
  db: Db = getMigrateDb()
): Promise<{ account: WhatsAppInboxAccountDocument; tenantId: string } | null> {
  const [row] = await db
    .select()
    .from(whatsappAccounts)
    .where(
      and(
        eq(whatsappAccounts.id, accountId),
        eq(whatsappAccounts.connectionMethod, 'byoa'),
        eq(whatsappAccounts.status, 'active')
      )
    )
    .limit(1)
  return row
    ? { account: rowToWhatsappAccount(row), tenantId: row.tenantId }
    : null
}

/**
 * Get account with decrypted token (for sending messages).
 */
export async function getAccountWithToken(
  tenantId: string,
  accountId: string,
  db: Db = getMigrateDb()
): Promise<{ account: WhatsAppInboxAccountDocument; accessToken: string }> {
  const account = await getInboxAccount(tenantId, accountId, db)
  if (!account) {
    throw new Error('Inbox account not found')
  }
  if (account.status !== 'active') {
    throw new Error('Inbox account is not active')
  }
  const accessToken = decryptToken(account.accessToken)
  return { account, accessToken }
}

// =====================================================
// Connect Flows
// =====================================================

/**
 * Full OAuth account connection flow:
 * 1. Exchange authorization code for user token
 * 2. Debug token to get WABA ID
 * 3. Subscribe to webhooks
 * 4. Get phone numbers
 * 5. Encrypt token and store in Postgres
 */
export async function connectOAuthAccount(
  params: ConnectOAuthParams,
  db: Db = getMigrateDb()
): Promise<WhatsAppInboxAccountDocument> {
  const { access_token: userToken } = await exchangeCodeForToken(params.code)
  const { wabaId } = await getWABAFromToken(userToken)
  await subscribeToWebhooks(wabaId, userToken)

  const phones = await getPhoneNumbers(wabaId, userToken)
  if (phones.length === 0) {
    throw new Error(
      'No phone numbers found on the WhatsApp Business Account. ' +
        'Please add a phone number in Meta Business Suite first.'
    )
  }
  const phone = phones[0]

  if (await existsActiveWaba(db, params.tenantId, wabaId)) {
    throw new Error(
      'This WhatsApp Business Account is already connected to your workspace.'
    )
  }

  return createAccountRow(
    {
      tenantId: params.tenantId,
      wabaId,
      phoneNumberId: phone.id,
      displayPhoneNumber: phone.display_phone_number,
      businessName: phone.verified_name,
      accessTokenEncrypted: encryptToken(userToken),
      scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
      connectedBy: params.userId,
      connectionMethod: 'oauth',
      webhookSubscribed: true
    },
    db
  )
}

/**
 * Connect a WhatsApp Business Account using a System User access token.
 */
export async function connectApiKeyAccount(
  params: ConnectApiKeyParams,
  db: Db = getMigrateDb()
): Promise<WhatsAppInboxAccountDocument> {
  const { tenantId, accessToken, wabaId, userId } = params

  const phones = await getPhoneNumbers(wabaId, accessToken)
  if (phones.length === 0) {
    throw new Error(
      'No phone numbers found on the WhatsApp Business Account. ' +
        'Please verify your WABA ID and access token.'
    )
  }
  const phone = phones[0]

  if (await existsActiveWaba(db, tenantId, wabaId)) {
    throw new Error(
      'This WhatsApp Business Account is already connected to your workspace.'
    )
  }

  await subscribeToWebhooks(wabaId, accessToken)

  return createAccountRow(
    {
      tenantId,
      wabaId,
      phoneNumberId: phone.id,
      displayPhoneNumber: phone.display_phone_number,
      businessName: phone.verified_name,
      accessTokenEncrypted: encryptToken(accessToken),
      scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
      connectedBy: userId,
      connectionMethod: 'api_key',
      webhookSubscribed: true
    },
    db
  )
}

/**
 * Connect a WhatsApp Business Account using customer's own Meta App (BYOA).
 */
export async function connectByoaAccount(
  params: ConnectByoaParams,
  db: Db = getMigrateDb()
): Promise<WhatsAppInboxAccountDocument> {
  const {
    tenantId,
    metaAppId,
    metaAppSecret,
    accessToken,
    webhookVerifyToken,
    wabaId,
    userId
  } = params

  const phones = await getPhoneNumbers(wabaId, accessToken)
  if (phones.length === 0) {
    throw new Error(
      'No phone numbers found on the WhatsApp Business Account. ' +
        'Please verify your WABA ID and access token.'
    )
  }
  const phone = phones[0]

  if (await existsActiveWaba(db, tenantId, wabaId)) {
    throw new Error(
      'This WhatsApp Business Account is already connected to your workspace.'
    )
  }

  let webhookSubscribed = false
  try {
    await subscribeToWebhooks(wabaId, accessToken)
    webhookSubscribed = true
  } catch (err: any) {
    console.warn('[WhatsApp BYOA] Webhook subscription failed:', err.message)
  }

  // Pre-generate id so it can be embedded in the per-account webhook URL.
  const id = uuidv7()
  let appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(
    /^http:/,
    'https:'
  )
  if (
    appUrl.includes('vibesboard.com') &&
    !appUrl.includes('www.vibesboard.com')
  ) {
    appUrl = appUrl.replace('://vibesboard.com', '://www.vibesboard.com')
  }
  const byoaWebhookUrl = `${appUrl}/api/webhooks/whatsapp-inbox/byoa/${id}`

  return createAccountRow(
    {
      id,
      tenantId,
      wabaId,
      phoneNumberId: phone.id,
      displayPhoneNumber: phone.display_phone_number,
      businessName: phone.verified_name,
      accessTokenEncrypted: encryptToken(accessToken),
      scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
      connectedBy: userId,
      connectionMethod: 'byoa',
      webhookSubscribed,
      metaAppId,
      metaAppSecretEncrypted: encryptToken(metaAppSecret),
      webhookVerifyTokenEncrypted: encryptToken(webhookVerifyToken),
      byoaWebhookUrl
    },
    db
  )
}
