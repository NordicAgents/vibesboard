import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

export const runtime = 'nodejs'

/**
 * GET - Webhook verification (Meta requirement)
 * Meta will call this endpoint with hub.mode, hub.verify_token, and hub.challenge
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('Webhook verified successfully')
    return new NextResponse(challenge, { status: 200 })
  }

  console.error('Webhook verification failed')
  return NextResponse.json(
    { error: 'Verification failed' },
    { status: 403 }
  )
}

/**
 * POST - Handle webhook events from Meta
 * Updates message delivery status, read status, and errors
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Meta webhook structure
    if (body.object !== 'whatsapp_business_account') {
      return NextResponse.json({ error: 'Invalid object type' }, { status: 400 })
    }

    // Process each entry
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue

        const value = change.value

        // Handle message status updates
        if (value.statuses && value.statuses.length > 0) {
          for (const status of value.statuses) {
            await updateMessageStatus(status)
          }
        }

        // Handle incoming messages (for opt-out)
        if (value.messages && value.messages.length > 0) {
          for (const message of value.messages) {
            await handleIncomingMessage(message)
          }
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Webhook processing error:', error)
    return NextResponse.json(
      { error: error.message || 'Webhook processing failed' },
      { status: 500 }
    )
  }
}

/**
 * Find a message queue item by WhatsApp message ID using collectionGroup query.
 * Returns the document snapshot and its parent campaign path (tenantId + campaignId).
 */
async function findQueueItemByMessageId(messageId: string) {
  const snap = await adminDb
    .collectionGroup('message_queue')
    .where('messageId', '==', messageId)
    .limit(1)
    .get()

  if (snap.empty) return null

  const doc = snap.docs[0]
  // Path: tenants/{tenantId}/whatsapp_campaigns/{campaignId}/message_queue/{docId}
  const pathParts = doc.ref.path.split('/')
  const tenantId = pathParts[1]
  const campaignId = pathParts[3]

  return { doc, tenantId, campaignId }
}

/**
 * Update message status in queue
 */
async function updateMessageStatus(status: any) {
  const messageId = status.id
  const statusType = status.status // sent, delivered, read, failed

  try {
    const result = await findQueueItemByMessageId(messageId)
    if (!result) return

    const { doc, tenantId, campaignId } = result
    const updateData: Record<string, any> = {}

    if (statusType === 'delivered') {
      updateData.status = 'delivered'
      updateData.deliveredAt = new Date(status.timestamp * 1000).toISOString()

      // Update campaign stats
      const campaignRef = adminDb
        .collection(`tenants/${tenantId}/whatsapp_campaigns`)
        .doc(campaignId)
      await campaignRef.update({
        messagesDelivered: FieldValue.increment(1),
      })
    } else if (statusType === 'read') {
      updateData.status = 'read'
      updateData.readAt = new Date(status.timestamp * 1000).toISOString()

      // Update campaign stats
      const campaignRef = adminDb
        .collection(`tenants/${tenantId}/whatsapp_campaigns`)
        .doc(campaignId)
      await campaignRef.update({
        messagesRead: FieldValue.increment(1),
      })
    } else if (statusType === 'failed') {
      updateData.status = 'failed'
      updateData.failedAt = new Date(status.timestamp * 1000).toISOString()
      updateData.error = status.errors?.[0]?.message || 'Unknown error'
    }

    if (Object.keys(updateData).length > 0) {
      updateData.updatedAt = new Date().toISOString()
      await doc.ref.update(updateData)
    }
  } catch (error) {
    console.error('Failed to update message status:', error)
  }
}

/**
 * Handle incoming messages (for opt-out detection)
 */
async function handleIncomingMessage(message: any) {
  const from = message.from
  const text = message.text?.body?.toLowerCase() || ''

  // Check for opt-out keywords
  if (text.includes('stop') || text.includes('unsubscribe') || text.includes('optout')) {
    try {
      // Find contact by phone number using collectionGroup
      const phoneNormalized = from.replace(/\D/g, '')

      const contactSnap = await adminDb
        .collectionGroup('whatsapp_contacts')
        .where('phoneNumberNormalized', '==', phoneNormalized)
        .limit(1)
        .get()

      if (!contactSnap.empty) {
        const contactDoc = contactSnap.docs[0]

        // Update opt-in status
        await contactDoc.ref.update({
          optedIn: false,
          optedOutAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })

        console.log(`Contact ${phoneNormalized} opted out`)
      }
    } catch (error) {
      console.error('Failed to handle opt-out:', error)
    }
  }
}
