import { NextRequest, NextResponse } from 'next/server'
import { findByoaAccountById, decryptToken } from '@/lib/instagram-inbox/accounts'
import { verifyWebhookSignature } from '@/lib/webhooks/verification'
import {
  processInboundMessageForAccount,
  processDeliveryUpdate,
  processReadUpdate,
} from '@/lib/instagram-inbox/webhook-handlers'

export const runtime = 'nodejs'

/**
 * GET — Webhook verification for BYOA accounts.
 * Each BYOA account has its own verify token, looked up by accountId.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const { accountId } = await params
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode !== 'subscribe' || !token || !challenge) {
    return NextResponse.json(
      { error: 'Missing verification parameters' },
      { status: 400 }
    )
  }

  const result = await findByoaAccountById(accountId)
  if (!result) {
    console.error(`[Instagram BYOA] No BYOA account found for ID ${accountId}`)
    return NextResponse.json(
      { error: 'Account not found' },
      { status: 404 }
    )
  }

  const { account } = result

  if (!account.webhookVerifyToken) {
    console.error(`[Instagram BYOA] No verify token stored for account ${accountId}`)
    return NextResponse.json(
      { error: 'Verification not configured' },
      { status: 500 }
    )
  }

  const expectedToken = decryptToken(account.webhookVerifyToken)

  if (token === expectedToken) {
    console.log(`[Instagram BYOA] Webhook verified for account ${accountId}`)
    return new NextResponse(challenge, { status: 200 })
  }

  console.error(`[Instagram BYOA] Webhook verification failed for account ${accountId}`)
  return NextResponse.json(
    { error: 'Verification failed' },
    { status: 403 }
  )
}

/**
 * POST — Handle inbound messages and status updates for a BYOA account.
 * Verifies the signature using the customer's own App Secret.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const { accountId } = await params

  try {
    // 1. Look up the BYOA account BEFORE reading body
    const result = await findByoaAccountById(accountId)
    if (!result) {
      console.error(`[Instagram BYOA] No BYOA account found for ID ${accountId}`)
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const { account, tenantId } = result

    if (!account.metaAppSecret) {
      console.error(`[Instagram BYOA] No app secret stored for account ${accountId}`)
      return NextResponse.json({ error: 'Configuration error' }, { status: 500 })
    }

    // 2. Read raw body and verify signature with customer's app secret
    const rawBody = await request.text()
    const signature = request.headers.get('x-hub-signature-256')
    const appSecret = decryptToken(account.metaAppSecret)

    if (!signature || !verifyWebhookSignature(rawBody, signature, appSecret)) {
      console.error(`[Instagram BYOA] Invalid webhook signature for account ${accountId}`)
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }

    // 3. Parse and process
    const body = JSON.parse(rawBody)

    if (body.object !== 'instagram') {
      return NextResponse.json(
        { error: 'Invalid object type' },
        { status: 400 }
      )
    }

    for (const entry of body.entry || []) {
      const pageId = entry.id

      for (const event of entry.messaging || []) {
        if (event.message && !event.message.is_echo && !event.message.is_deleted) {
          await processInboundMessageForAccount(account, tenantId, pageId, event)
        }

        if (event.delivery) {
          await processDeliveryUpdate(event)
        }

        if (event.read) {
          await processReadUpdate(event)
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error(`[Instagram BYOA] Webhook error for account ${accountId}:`, error)
    // Always return 200 to prevent Meta from retrying
    return NextResponse.json({ success: true })
  }
}
