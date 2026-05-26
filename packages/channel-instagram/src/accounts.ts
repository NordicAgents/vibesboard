import { and, eq, desc } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { instagramAccounts } from '@vibesboard/adapter-postgres/schema'
import { type InstagramInboxAccountDocument } from '@vibesboard/contracts'
import CryptoJS from 'crypto-js'
import { rowToInstagramAccount } from './db.ts'
import type {
  ConnectOAuthParams,
  ConnectApiKeyParams,
  ConnectByoaParams,
  InstagramAccountInfo,
  MetaTokenResponse,
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
 * Exchange a short-lived user token for a long-lived user token (~60 days).
 */
export async function exchangeForLongLivedToken(
  shortLivedToken: string
): Promise<string> {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID
  const appSecret = process.env.META_APP_SECRET

  const url = new URL(`${META_GRAPH_API}/oauth/access_token`)
  url.searchParams.set('grant_type', 'fb_exchange_token')
  url.searchParams.set('client_id', appId!)
  url.searchParams.set('client_secret', appSecret!)
  url.searchParams.set('fb_exchange_token', shortLivedToken)

  const response = await fetch(url.toString())

  if (!response.ok) {
    const error = await response.json()
    throw new Error(
      `Long-lived token exchange failed: ${error.error?.message || 'Unknown error'}`
    )
  }

  const data = await response.json()
  return data.access_token
}

/**
 * Get a non-expiring page access token for a Facebook Page.
 * Requires a long-lived user access token.
 */
export async function getPageAccessToken(
  pageId: string,
  longLivedUserToken: string
): Promise<string> {
  const response = await fetch(
    `${META_GRAPH_API}/${pageId}?fields=access_token`,
    {
      headers: {
        Authorization: `Bearer ${longLivedUserToken}`
      }
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(
      `Failed to get page access token: ${error.error?.message || 'Unknown error'}`
    )
  }

  const data = await response.json()
  return data.access_token
}

/**
 * Get the Instagram Business Account linked to a Facebook Page.
 */
export async function getInstagramAccountForPage(
  pageId: string,
  pageToken: string
): Promise<InstagramAccountInfo> {
  const response = await fetch(
    `${META_GRAPH_API}/${pageId}?fields=instagram_business_account{username,name,profile_picture_url},name`,
    {
      headers: {
        Authorization: `Bearer ${pageToken}`
      }
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(
      `Failed to get Instagram account: ${error.error?.message || 'Unknown error'}`
    )
  }

  const data = await response.json()

  if (!data.instagram_business_account) {
    throw new Error(
      'No Instagram Business Account linked to this Facebook Page. ' +
        'Please link an Instagram Business or Creator account in Meta Business Suite.'
    )
  }

  const ig = data.instagram_business_account
  return {
    id: ig.id,
    username: ig.username || '',
    name: ig.name || data.name || '',
    profile_picture_url: ig.profile_picture_url
  }
}

/**
 * Subscribe a Facebook Page to webhooks for Instagram messaging.
 */
export async function subscribeToWebhooks(
  pageId: string,
  pageToken: string
): Promise<void> {
  const response = await fetch(
    `${META_GRAPH_API}/${pageId}/subscribed_apps?subscribed_fields=messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pageToken}`
      }
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(
      `Webhook subscription failed: ${error.error?.message || 'Unknown error'}`
    )
  }
}

// =====================================================
// Account Operations (Postgres)
// =====================================================

export interface CreateAccountRowParams {
  tenantId: string
  instagramAccountId: string
  pageId: string
  pageName: string
  instagramUsername: string
  accessTokenEncrypted: string
  connectedBy: string
  connectionMethod: 'oauth' | 'api_key' | 'byoa'
  webhookSubscribed: boolean
  scopes: string[]
  id?: string
  metaUserId?: string
  metaAppId?: string
  metaAppSecretEncrypted?: string
  webhookVerifyTokenEncrypted?: string
  byoaWebhookUrl?: string
}

async function existsActiveInstagramAccount(
  db: Db,
  tenantId: string,
  instagramAccountId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: instagramAccounts.id })
    .from(instagramAccounts)
    .where(
      and(
        eq(instagramAccounts.tenantId, tenantId),
        eq(instagramAccounts.instagramAccountId, instagramAccountId),
        eq(instagramAccounts.status, 'active')
      )
    )
    .limit(1)
  return !!row
}

/**
 * Insert an Instagram inbox account row and return the legacy doc shape.
 */
export async function createAccountRow(
  p: CreateAccountRowParams,
  db: Db = getMigrateDb()
): Promise<InstagramInboxAccountDocument> {
  const id = p.id ?? uuidv7()
  const [row] = await db
    .insert(instagramAccounts)
    .values({
      id,
      tenantId: p.tenantId,
      instagramAccountId: p.instagramAccountId,
      pageId: p.pageId,
      pageName: p.pageName,
      instagramUsername: p.instagramUsername,
      accessTokenEncrypted: p.accessTokenEncrypted,
      scopes: p.scopes,
      status: 'active',
      connectedBy: p.connectedBy,
      webhookSubscribed: p.webhookSubscribed,
      metaUserId: p.metaUserId ?? null,
      connectionMethod: p.connectionMethod,
      metaAppId: p.metaAppId ?? null,
      metaAppSecretEncrypted: p.metaAppSecretEncrypted ?? null,
      webhookVerifyTokenEncrypted: p.webhookVerifyTokenEncrypted ?? null,
      byoaWebhookUrl: p.byoaWebhookUrl ?? null
    })
    .returning()
  return rowToInstagramAccount(row)
}

/**
 * List inbox accounts for a tenant.
 */
export async function listInboxAccounts(
  tenantId: string,
  db: Db = getMigrateDb()
): Promise<InstagramInboxAccountDocument[]> {
  const rows = await db
    .select()
    .from(instagramAccounts)
    .where(eq(instagramAccounts.tenantId, tenantId))
    .orderBy(desc(instagramAccounts.createdAt))
  return rows.map(rowToInstagramAccount)
}

/**
 * Get a single inbox account.
 */
export async function getInboxAccount(
  tenantId: string,
  accountId: string,
  db: Db = getMigrateDb()
): Promise<InstagramInboxAccountDocument | null> {
  const [row] = await db
    .select()
    .from(instagramAccounts)
    .where(
      and(
        eq(instagramAccounts.tenantId, tenantId),
        eq(instagramAccounts.id, accountId)
      )
    )
    .limit(1)
  return row ? rowToInstagramAccount(row) : null
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
    .update(instagramAccounts)
    .set({ status: 'disconnected', updatedAt: new Date() })
    .where(
      and(
        eq(instagramAccounts.tenantId, tenantId),
        eq(instagramAccounts.id, accountId)
      )
    )
}

/**
 * Permanently delete an inbox account. Conversations and messages cascade
 * via FK onDelete: 'cascade'. Should only be used on disconnected accounts.
 */
export async function deleteInboxAccount(
  tenantId: string,
  accountId: string,
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .delete(instagramAccounts)
    .where(
      and(
        eq(instagramAccounts.tenantId, tenantId),
        eq(instagramAccounts.id, accountId)
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
    .update(instagramAccounts)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(instagramAccounts.tenantId, tenantId),
        eq(instagramAccounts.id, accountId)
      )
    )
}

/**
 * Find an active inbox account by Page ID (for webhook routing, no tenant filter).
 */
export async function findAccountByPageId(
  pageId: string,
  db: Db = getMigrateDb()
): Promise<{ account: InstagramInboxAccountDocument; tenantId: string } | null> {
  const [row] = await db
    .select()
    .from(instagramAccounts)
    .where(
      and(
        eq(instagramAccounts.pageId, pageId),
        eq(instagramAccounts.status, 'active')
      )
    )
    .limit(1)
  return row
    ? { account: rowToInstagramAccount(row), tenantId: row.tenantId }
    : null
}

/**
 * Find an active BYOA account by id (for per-account webhook routing).
 */
export async function findByoaAccountById(
  accountId: string,
  db: Db = getMigrateDb()
): Promise<{ account: InstagramInboxAccountDocument; tenantId: string } | null> {
  const [row] = await db
    .select()
    .from(instagramAccounts)
    .where(
      and(
        eq(instagramAccounts.id, accountId),
        eq(instagramAccounts.connectionMethod, 'byoa'),
        eq(instagramAccounts.status, 'active')
      )
    )
    .limit(1)
  return row
    ? { account: rowToInstagramAccount(row), tenantId: row.tenantId }
    : null
}

/**
 * Get account with decrypted token (for sending messages).
 */
export async function getAccountWithToken(
  tenantId: string,
  accountId: string,
  db: Db = getMigrateDb()
): Promise<{ account: InstagramInboxAccountDocument; accessToken: string }> {
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
 * 1. Exchange authorization code for short-lived user token
 * 2. Exchange for long-lived user token
 * 3. Get page access token + Instagram Business Account info
 * 4. Subscribe page to webhooks
 * 5. Encrypt page token and store in Postgres
 */
export async function connectOAuthAccount(
  params: ConnectOAuthParams,
  db: Db = getMigrateDb()
): Promise<InstagramInboxAccountDocument> {
  // 1. Exchange code for short-lived user access token
  const { access_token: shortToken } = await exchangeCodeForToken(params.code)

  // 2. Exchange for long-lived user token
  const longLivedToken = await exchangeForLongLivedToken(shortToken)

  // 3. Get user's pages to find the one linked to Instagram
  const pagesResponse = await fetch(
    `${META_GRAPH_API}/me/accounts?fields=id,name,access_token`,
    {
      headers: {
        Authorization: `Bearer ${longLivedToken}`
      }
    }
  )

  if (!pagesResponse.ok) {
    const error = await pagesResponse.json()
    throw new Error(
      `Failed to get pages: ${error.error?.message || 'Unknown error'}`
    )
  }

  const pagesData = await pagesResponse.json()
  const pages = pagesData.data || []

  if (pages.length === 0) {
    throw new Error(
      'No Facebook Pages found. Please ensure your account has at least one Facebook Page.'
    )
  }

  // Find the first page with an Instagram Business Account
  let selectedPage: any = null
  let igAccount: InstagramAccountInfo | null = null

  for (const page of pages) {
    try {
      igAccount = await getInstagramAccountForPage(page.id, page.access_token)
      selectedPage = page
      break
    } catch {
      // This page doesn't have an IG account linked, try next
      continue
    }
  }

  if (!selectedPage || !igAccount) {
    throw new Error(
      'No Facebook Page with a linked Instagram Business Account was found. ' +
        'Please link an Instagram Business or Creator account to a Facebook Page in Meta Business Suite.'
    )
  }

  const pageToken = selectedPage.access_token

  // 4. Get the Facebook app-scoped user ID (needed for Meta data deletion callback)
  let metaUserId: string | undefined
  try {
    const meResponse = await fetch(`${META_GRAPH_API}/me?fields=id`, {
      headers: { Authorization: `Bearer ${longLivedToken}` }
    })
    if (meResponse.ok) {
      const meData = await meResponse.json()
      metaUserId = meData.id
    }
  } catch {
    // Non-critical — continue without storing Meta user ID
  }

  // 5. Subscribe page to webhooks
  await subscribeToWebhooks(selectedPage.id, pageToken)

  // 6. Check for duplicate Instagram account
  if (await existsActiveInstagramAccount(db, params.tenantId, igAccount.id)) {
    throw new Error(
      'This Instagram account is already connected to your workspace.'
    )
  }

  // 7. Encrypt token and store
  return createAccountRow(
    {
      tenantId: params.tenantId,
      instagramAccountId: igAccount.id,
      pageId: selectedPage.id,
      pageName: selectedPage.name,
      instagramUsername: igAccount.username,
      accessTokenEncrypted: encryptToken(pageToken),
      scopes: [
        'instagram_basic',
        'instagram_manage_messages',
        'pages_manage_metadata',
        'pages_messaging'
      ],
      connectedBy: params.userId,
      connectionMethod: 'oauth',
      metaUserId,
      webhookSubscribed: true
    },
    db
  )
}

/**
 * Connect an Instagram account using a Page access token.
 * Validates the token by fetching the Instagram Business Account info,
 * subscribes to webhooks, then encrypts and stores the account.
 */
export async function connectApiKeyAccount(
  params: ConnectApiKeyParams,
  db: Db = getMigrateDb()
): Promise<InstagramInboxAccountDocument> {
  const { tenantId, accessToken, pageId, userId } = params

  // 1. Validate token by fetching Instagram account info
  const igAccount = await getInstagramAccountForPage(pageId, accessToken)

  // 2. Check for duplicate Instagram account
  if (await existsActiveInstagramAccount(db, tenantId, igAccount.id)) {
    throw new Error(
      'This Instagram account is already connected to your workspace.'
    )
  }

  // 3. Get page name
  const pageResponse = await fetch(`${META_GRAPH_API}/${pageId}?fields=name`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })
  const pageData = pageResponse.ok ? await pageResponse.json() : { name: '' }

  // 4. Subscribe to webhooks (best-effort — may fail if pages_messaging
  //    permission is not approved via App Review). Webhooks can also be
  //    configured manually in the Meta App Dashboard.
  let webhookSubscribed = false
  try {
    await subscribeToWebhooks(pageId, accessToken)
    webhookSubscribed = true
  } catch (err: any) {
    if (
      err.message?.includes('#210') ||
      err.message?.includes('page access token')
    ) {
      // Token is a user token — try exchanging for a page access token
      try {
        const pageToken = await getPageAccessToken(pageId, accessToken)
        await subscribeToWebhooks(pageId, pageToken)
        webhookSubscribed = true
      } catch (retryErr: any) {
        console.warn(
          'Webhook subscription failed after token exchange:',
          retryErr.message
        )
      }
    } else {
      console.warn('Webhook subscription failed:', err.message)
    }
  }

  // 5. Encrypt token and store
  return createAccountRow(
    {
      tenantId,
      instagramAccountId: igAccount.id,
      pageId,
      pageName: pageData.name || '',
      instagramUsername: igAccount.username,
      accessTokenEncrypted: encryptToken(accessToken),
      scopes: [
        'instagram_basic',
        'instagram_manage_messages',
        'pages_manage_metadata'
      ],
      connectedBy: userId,
      connectionMethod: 'api_key',
      webhookSubscribed
    },
    db
  )
}

/**
 * Connect an Instagram account using customer's own Meta App (BYOA).
 * Customer provides their own App ID, App Secret, access token, and webhook verify token.
 */
export async function connectByoaAccount(
  params: ConnectByoaParams,
  db: Db = getMigrateDb()
): Promise<InstagramInboxAccountDocument> {
  const {
    tenantId,
    metaAppId,
    metaAppSecret,
    accessToken,
    webhookVerifyToken,
    pageId,
    userId
  } = params

  // 1. Validate token by fetching Instagram account info
  const igAccount = await getInstagramAccountForPage(pageId, accessToken)

  // 2. Check for duplicate Instagram account
  if (await existsActiveInstagramAccount(db, tenantId, igAccount.id)) {
    throw new Error(
      'This Instagram account is already connected to your workspace.'
    )
  }

  // 3. Get page name
  const pageResponse = await fetch(`${META_GRAPH_API}/${pageId}?fields=name`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })
  const pageData = pageResponse.ok ? await pageResponse.json() : { name: '' }

  // 4. Subscribe page to webhooks (required for Meta to send events).
  //    Try with the provided token first; if it fails (e.g. system user token
  //    instead of page token), try exchanging for a page access token.
  let webhookSubscribed = false
  try {
    await subscribeToWebhooks(pageId, accessToken)
    webhookSubscribed = true
  } catch (err: any) {
    if (
      err.message?.includes('#210') ||
      err.message?.includes('page access token')
    ) {
      try {
        const pageToken = await getPageAccessToken(pageId, accessToken)
        await subscribeToWebhooks(pageId, pageToken)
        webhookSubscribed = true
      } catch (retryErr: any) {
        console.warn(
          '[Instagram BYOA] Webhook subscription failed after token exchange:',
          retryErr.message
        )
      }
    } else {
      console.warn('[Instagram BYOA] Webhook subscription failed:', err.message)
    }
  }

  // 5. Pre-generate id so it can be embedded in the per-account webhook URL.
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
  const byoaWebhookUrl = `${appUrl}/api/webhooks/instagram-inbox/byoa/${id}`

  // 6. Encrypt secrets and store
  return createAccountRow(
    {
      id,
      tenantId,
      instagramAccountId: igAccount.id,
      pageId,
      pageName: pageData.name || '',
      instagramUsername: igAccount.username,
      accessTokenEncrypted: encryptToken(accessToken),
      scopes: [
        'instagram_basic',
        'instagram_manage_messages',
        'pages_manage_metadata'
      ],
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
