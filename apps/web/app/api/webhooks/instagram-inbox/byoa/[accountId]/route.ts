import { NextRequest, NextResponse } from 'next/server'
import {
  findByoaAccountById,
  decryptToken
} from '@vibesboard/channel-instagram/accounts'
import { verifyWebhookSignature } from '@/lib/webhooks/verification'
import {
  processInboundMessageForAccount,
  processDeliveryUpdate,
  processReadUpdate
} from '@vibesboard/channel-instagram/webhook-handlers'

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
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  const { account } = result

  if (!account.webhookVerifyToken) {
    console.error(
      `[Instagram BYOA] No verify token stored for account ${accountId}`
    )
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

  console.error(
    `[Instagram BYOA] Webhook verification failed for account ${accountId}`
  )
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
}

async function validateByoaRequest(accountId: string, request: NextRequest) {
  const result = await findByoaAccountById(accountId)
  if (!result) {
    console.error(`[Instagram BYOA] No BYOA account found for ID ${accountId}`)
    return {
      error: NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }
  }

  const { account, tenantId } = result

  if (!account.metaAppSecret) {
    console.error(
      `[Instagram BYOA] No app secret stored for account ${accountId}`
    )
    return {
      error: NextResponse.json(
        { error: 'Configuration error' },
        { status: 500 }
      )
    }
  }

  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  const appSecret = decryptToken(account.metaAppSecret)

  if (!signature || !verifyWebhookSignature(rawBody, signature, appSecret)) {
    console.error(
      `[Instagram BYOA] Invalid webhook signature for account ${accountId}`
    )
    return {
      error: NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }
  }

  return { account, tenantId, rawBody }
}

async function processEntries(entries: any[], account: any, tenantId: string) {
  for (const entry of entries) {
    const pageId = entry.id

    for (const event of entry.messaging || []) {
      if (
        event.message &&
        !event.message.is_echo &&
        !event.message.is_deleted
      ) {
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
    const validated = await validateByoaRequest(accountId, request)
    if ('error' in validated) return validated.error

    const { account, tenantId, rawBody } = validated
    const body = JSON.parse(rawBody)

    if (body.object !== 'instagram') {
      console.warn(
        `[Instagram BYOA] Unexpected object type "${body.object}" for account ${accountId}`
      )
      return NextResponse.json(
        { error: 'Invalid object type' },
        { status: 400 }
      )
    }

    const entries = body.entry || []
    console.log(
      `[Instagram BYOA] Received ${entries.length} entries for account ${accountId}`
    )
    await processEntries(entries, account, tenantId)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error(
      `[Instagram BYOA] Webhook error for account ${accountId}:`,
      error
    )
    return NextResponse.json({ success: true })
  }
}
