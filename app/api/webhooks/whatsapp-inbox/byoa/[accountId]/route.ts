import { NextRequest, NextResponse } from 'next/server'
import {
  findByoaAccountById,
  decryptToken
} from '@/lib/whatsapp-inbox/accounts'
import { verifyWebhookSignature } from '@/lib/webhooks/verification'
import {
  processInboundMessagesForAccount,
  processStatusUpdates
} from '@/lib/whatsapp-inbox/webhook-handlers'

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
    console.error(`[WhatsApp BYOA] No BYOA account found for ID ${accountId}`)
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  const { account } = result

  if (!account.webhookVerifyToken) {
    console.error(
      `[WhatsApp BYOA] No verify token stored for account ${accountId}`
    )
    return NextResponse.json(
      { error: 'Verification not configured' },
      { status: 500 }
    )
  }

  const expectedToken = decryptToken(account.webhookVerifyToken)

  if (token === expectedToken) {
    console.log(`[WhatsApp BYOA] Webhook verified for account ${accountId}`)
    return new NextResponse(challenge, { status: 200 })
  }

  console.error(
    `[WhatsApp BYOA] Webhook verification failed for account ${accountId}`
  )
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
}

async function validateByoaRequest(accountId: string, request: NextRequest) {
  const result = await findByoaAccountById(accountId)
  if (!result) {
    console.error(`[WhatsApp BYOA] No BYOA account found for ID ${accountId}`)
    return {
      error: NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }
  }

  const { account, tenantId } = result

  if (!account.metaAppSecret) {
    console.error(
      `[WhatsApp BYOA] No app secret stored for account ${accountId}`
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
      `[WhatsApp BYOA] Invalid webhook signature for account ${accountId}`
    )
    return {
      error: NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }
  }

  return { account, tenantId, rawBody }
}

async function processEntries(entries: any[], account: any, tenantId: string) {
  for (const entry of entries) {
    const wabaId = entry.id

    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue

      const value = change.value
      const phoneNumberId = value.metadata?.phone_number_id

      if (value.messages?.length > 0) {
        await processInboundMessagesForAccount(
          account,
          tenantId,
          wabaId,
          phoneNumberId,
          value.messages,
          value.contacts
        )
      }

      if (value.statuses?.length > 0) {
        await processStatusUpdates(value.statuses)
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

    if (body.object !== 'whatsapp_business_account') {
      return NextResponse.json(
        { error: 'Invalid object type' },
        { status: 400 }
      )
    }

    await processEntries(body.entry || [], account, tenantId)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error(
      `[WhatsApp BYOA] Webhook error for account ${accountId}:`,
      error
    )
    return NextResponse.json({ success: true })
  }
}
