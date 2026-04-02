import { adminDb } from '@/lib/firebase/admin'
import {
  Collections,
  type InstagramInboxAccountDocument,
} from '@/lib/firestore-types'
import CryptoJS from 'crypto-js'
import type {
  ConnectOAuthParams,
  ConnectApiKeyParams,
  ConnectByoaParams,
  InstagramAccountInfo,
  MetaTokenResponse,
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
        Authorization: `Bearer ${longLivedUserToken}`,
      },
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
        Authorization: `Bearer ${pageToken}`,
      },
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
    profile_picture_url: ig.profile_picture_url,
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
        Authorization: `Bearer ${pageToken}`,
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

// =====================================================
// Account Operations
// =====================================================

/**
 * Full OAuth account connection flow:
 * 1. Exchange authorization code for short-lived user token
 * 2. Exchange for long-lived user token
 * 3. Get page access token (non-expiring)
 * 4. Get Instagram Business Account info
 * 5. Subscribe page to webhooks
 * 6. Check for duplicates
 * 7. Encrypt page token and store in Firestore
 */
export async function connectOAuthAccount(
  params: ConnectOAuthParams
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
        Authorization: `Bearer ${longLivedToken}`,
      },
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

  // 5. Get the Facebook app-scoped user ID (needed for Meta data deletion callback)
  let metaUserId: string | undefined
  try {
    const meResponse = await fetch(`${META_GRAPH_API}/me?fields=id`, {
      headers: { Authorization: `Bearer ${longLivedToken}` },
    })
    if (meResponse.ok) {
      const meData = await meResponse.json()
      metaUserId = meData.id
    }
  } catch {
    // Non-critical — continue without storing Meta user ID
  }

  // 6. Subscribe page to webhooks
  await subscribeToWebhooks(selectedPage.id, pageToken)

  // 7. Check for duplicate Instagram account
  const collRef = adminDb.collection(
    Collections.instagramInboxAccounts(params.tenantId)
  )
  const existingSnap = await collRef
    .where('instagramAccountId', '==', igAccount.id)
    .where('status', '==', 'active')
    .limit(1)
    .get()

  if (!existingSnap.empty) {
    throw new Error(
      'This Instagram account is already connected to your workspace.'
    )
  }

  // 8. Encrypt token and store
  const now = new Date().toISOString()
  const docRef = collRef.doc()
  const account: InstagramInboxAccountDocument = {
    id: docRef.id,
    tenantId: params.tenantId,
    instagramAccountId: igAccount.id,
    pageId: selectedPage.id,
    pageName: selectedPage.name,
    instagramUsername: igAccount.username,
    accessToken: encryptToken(pageToken),
    scopes: ['instagram_basic', 'instagram_manage_messages', 'pages_manage_metadata', 'pages_messaging'],
    status: 'active',
    connectedBy: params.userId,
    connectedAt: now,
    connectionMethod: 'oauth',
    metaUserId,
    webhookSubscribed: true,
    createdAt: now,
    updatedAt: now,
  }

  await docRef.set(account)

  return account
}

/**
 * Connect an Instagram account using a Page access token.
 * Validates the token by fetching the Instagram Business Account info,
 * subscribes to webhooks, then encrypts and stores the account.
 */
export async function connectApiKeyAccount(
  params: ConnectApiKeyParams
): Promise<InstagramInboxAccountDocument> {
  const { tenantId, accessToken, pageId, userId } = params

  // 1. Validate token by fetching Instagram account info
  const igAccount = await getInstagramAccountForPage(pageId, accessToken)

  // 2. Check for duplicate Instagram account
  const collRef = adminDb.collection(
    Collections.instagramInboxAccounts(tenantId)
  )
  const existingSnap = await collRef
    .where('instagramAccountId', '==', igAccount.id)
    .where('status', '==', 'active')
    .limit(1)
    .get()

  if (!existingSnap.empty) {
    throw new Error(
      'This Instagram account is already connected to your workspace.'
    )
  }

  // 3. Get page name
  const pageResponse = await fetch(
    `${META_GRAPH_API}/${pageId}?fields=name`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )
  const pageData = pageResponse.ok ? await pageResponse.json() : { name: '' }

  // 4. Subscribe to webhooks (best-effort — may fail if pages_messaging
  //    permission is not approved via App Review). Webhooks can also be
  //    configured manually in the Meta App Dashboard.
  let webhookSubscribed = false
  try {
    await subscribeToWebhooks(pageId, accessToken)
    webhookSubscribed = true
  } catch (err: any) {
    if (err.message?.includes('#210') || err.message?.includes('page access token')) {
      // Token is a user token — try exchanging for a page access token
      try {
        const pageToken = await getPageAccessToken(pageId, accessToken)
        await subscribeToWebhooks(pageId, pageToken)
        webhookSubscribed = true
      } catch (retryErr: any) {
        console.warn('Webhook subscription failed after token exchange:', retryErr.message)
      }
    } else {
      console.warn('Webhook subscription failed:', err.message)
    }
  }

  // 5. Encrypt token and store
  const now = new Date().toISOString()
  const docRef = collRef.doc()
  const account: InstagramInboxAccountDocument = {
    id: docRef.id,
    tenantId,
    instagramAccountId: igAccount.id,
    pageId,
    pageName: pageData.name || '',
    instagramUsername: igAccount.username,
    accessToken: encryptToken(accessToken),
    scopes: ['instagram_basic', 'instagram_manage_messages', 'pages_manage_metadata'],
    status: 'active',
    connectedBy: userId,
    connectedAt: now,
    connectionMethod: 'api_key',
    webhookSubscribed,
    createdAt: now,
    updatedAt: now,
  }

  await docRef.set(account)
  return account
}

/**
 * Connect an Instagram account using customer's own Meta App (BYOA).
 * Customer provides their own App ID, App Secret, access token, and webhook verify token.
 * Webhook subscription is NOT done — customer configures their own Meta App webhooks.
 */
export async function connectByoaAccount(
  params: ConnectByoaParams
): Promise<InstagramInboxAccountDocument> {
  const { tenantId, metaAppId, metaAppSecret, accessToken, webhookVerifyToken, pageId, userId } = params

  // 1. Validate token by fetching Instagram account info
  const igAccount = await getInstagramAccountForPage(pageId, accessToken)

  // 2. Check for duplicate Instagram account
  const collRef = adminDb.collection(
    Collections.instagramInboxAccounts(tenantId)
  )
  const existingSnap = await collRef
    .where('instagramAccountId', '==', igAccount.id)
    .where('status', '==', 'active')
    .limit(1)
    .get()

  if (!existingSnap.empty) {
    throw new Error(
      'This Instagram account is already connected to your workspace.'
    )
  }

  // 3. Get page name
  const pageResponse = await fetch(
    `${META_GRAPH_API}/${pageId}?fields=name`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )
  const pageData = pageResponse.ok ? await pageResponse.json() : { name: '' }

  // 4. Subscribe page to webhooks (required for Meta to send events).
  //    Try with the provided token first; if it fails (e.g. system user token
  //    instead of page token), try exchanging for a page access token.
  let webhookSubscribed = false
  try {
    await subscribeToWebhooks(pageId, accessToken)
    webhookSubscribed = true
  } catch (err: any) {
    if (err.message?.includes('#210') || err.message?.includes('page access token')) {
      try {
        const pageToken = await getPageAccessToken(pageId, accessToken)
        await subscribeToWebhooks(pageId, pageToken)
        webhookSubscribed = true
      } catch (retryErr: any) {
        console.warn('[Instagram BYOA] Webhook subscription failed after token exchange:', retryErr.message)
      }
    } else {
      console.warn('[Instagram BYOA] Webhook subscription failed:', err.message)
    }
  }

  // 5. Generate document and webhook URL
  const docRef = collRef.doc()
  let appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/^http:/, 'https:')
  if (appUrl.includes('vibesboard.com') && !appUrl.includes('www.vibesboard.com')) {
    appUrl = appUrl.replace('://vibesboard.com', '://www.vibesboard.com')
  }
  const byoaWebhookUrl = `${appUrl}/api/webhooks/instagram-inbox/byoa/${docRef.id}`

  // 6. Encrypt secrets and store
  const now = new Date().toISOString()
  const account: InstagramInboxAccountDocument = {
    id: docRef.id,
    tenantId,
    instagramAccountId: igAccount.id,
    pageId,
    pageName: pageData.name || '',
    instagramUsername: igAccount.username,
    accessToken: encryptToken(accessToken),
    scopes: ['instagram_basic', 'instagram_manage_messages', 'pages_manage_metadata'],
    status: 'active',
    connectedBy: userId,
    connectedAt: now,
    connectionMethod: 'byoa',
    metaAppId,
    metaAppSecret: encryptToken(metaAppSecret),
    webhookVerifyToken: encryptToken(webhookVerifyToken),
    byoaWebhookUrl,
    webhookSubscribed,
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
): Promise<{ account: InstagramInboxAccountDocument; tenantId: string } | null> {
  const snap = await adminDb
    .collectionGroup('instagram_inbox_accounts')
    .where('id', '==', accountId)
    .where('connectionMethod', '==', 'byoa')
    .where('status', '==', 'active')
    .limit(1)
    .get()

  if (snap.empty) return null

  const doc = snap.docs[0]!
  const account = doc.data() as InstagramInboxAccountDocument
  const tenantId = doc.ref.path.split('/')[1]

  return { account, tenantId }
}

/**
 * List inbox accounts for a tenant.
 */
export async function listInboxAccounts(
  tenantId: string
): Promise<InstagramInboxAccountDocument[]> {
  const snap = await adminDb
    .collection(Collections.instagramInboxAccounts(tenantId))
    .orderBy('createdAt', 'desc')
    .get()

  return snap.docs.map((d: any) => d.data() as InstagramInboxAccountDocument)
}

/**
 * Get a single inbox account.
 */
export async function getInboxAccount(
  tenantId: string,
  accountId: string
): Promise<InstagramInboxAccountDocument | null> {
  const snap = await adminDb
    .collection(Collections.instagramInboxAccounts(tenantId))
    .doc(accountId)
    .get()

  return snap.exists
    ? (snap.data() as InstagramInboxAccountDocument)
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
    .collection(Collections.instagramInboxAccounts(tenantId))
    .doc(accountId)
    .update({
      status: 'disconnected',
      updatedAt: new Date().toISOString(),
    })
}

/**
 * Permanently delete an inbox account and all its subcollections from Firestore.
 * Should only be used on already-disconnected accounts.
 */
export async function deleteInboxAccount(
  tenantId: string,
  accountId: string
): Promise<void> {
  const BATCH_SIZE = 500

  // Delete all conversations and their messages
  const conversationsSnap = await adminDb
    .collection(
      `tenants/${tenantId}/instagram_inbox_accounts/${accountId}/conversations`
    )
    .get()

  for (const convDoc of conversationsSnap.docs) {
    const messagesSnap = await adminDb
      .collection(
        `tenants/${tenantId}/instagram_inbox_accounts/${accountId}/conversations/${convDoc.id}/messages`
      )
      .get()

    for (let i = 0; i < messagesSnap.docs.length; i += BATCH_SIZE) {
      const chunk = messagesSnap.docs.slice(i, i + BATCH_SIZE)
      const batch = adminDb.batch()
      chunk.forEach((msgDoc) => batch.delete(msgDoc.ref))
      await batch.commit()
    }

    await convDoc.ref.delete()
  }

  // Delete the account document
  await adminDb
    .collection(Collections.instagramInboxAccounts(tenantId))
    .doc(accountId)
    .delete()
}

/**
 * Find an inbox account by Page ID (for webhook routing).
 * Uses collectionGroup query to search across all tenants.
 */
export async function findAccountByPageId(
  pageId: string
): Promise<{ account: InstagramInboxAccountDocument; tenantId: string } | null> {
  const snap = await adminDb
    .collectionGroup('instagram_inbox_accounts')
    .where('pageId', '==', pageId)
    .where('status', '==', 'active')
    .limit(1)
    .get()

  if (snap.empty) return null

  const doc = snap.docs[0]!
  const account = doc.data() as InstagramInboxAccountDocument
  // Path: tenants/{tenantId}/instagram_inbox_accounts/{accountId}
  const tenantId = doc.ref.path.split('/')[1]

  return { account, tenantId }
}

/**
 * Get account with decrypted token (for sending messages).
 */
export async function getAccountWithToken(
  tenantId: string,
  accountId: string
): Promise<{ account: InstagramInboxAccountDocument; accessToken: string }> {
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
