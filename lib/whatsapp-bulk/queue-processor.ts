import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  Collections,
  type MessageQueueDocument,
  type WhatsAppBusinessAccountDocument,
} from '@/lib/firestore-types'
import { decryptToken } from './business-accounts'
import { sendTemplateMessage, WhatsAppAPIError } from './template-sender'

/**
 * WhatsApp Message Queue Processor
 *
 * Processes pending messages from the Firestore queue:
 * - Fetch pending messages (20 at a time)
 * - Send via Meta WhatsApp API
 * - Update status and handle retries
 * - Auto-complete campaigns when done
 *
 * Called by Vercel cron job every 30 seconds
 */

// =====================================================
// Types & Interfaces
// =====================================================

export interface ProcessResult {
  processed: number
  succeeded: number
  failed: number
  skipped: number
}

// =====================================================
// Queue Processing
// =====================================================

/**
 * Process pending messages from all campaigns across all tenants
 * Called by cron job every 30 seconds
 *
 * Since queue items are nested under tenants/campaigns, we use collectionGroup
 * to query across all tenants.
 *
 * @param batchSize Number of messages to process per run (default: 20)
 */
export async function processMessageQueue(
  batchSize: number = 20
): Promise<ProcessResult> {
  const result: ProcessResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  }

  try {
    // Use collectionGroup to query message_queue across all campaigns/tenants
    const messagesSnap = await adminDb
      .collectionGroup('message_queue')
      .where('status', '==', 'pending')
      .orderBy('createdAt')
      .limit(batchSize)
      .get()

    if (messagesSnap.empty) {
      return result
    }

    // Process each message
    for (const doc of messagesSnap.docs) {
      try {
        await processQueueItem(doc)
        result.succeeded++
      } catch (error) {
        console.error(`Failed to process queue item ${doc.id}:`, error)
        result.failed++
      }
      result.processed++
    }

    return result
  } catch (error) {
    console.error('Queue processing error:', error)
    throw error
  }
}

/**
 * Process a single queue item
 */
async function processQueueItem(
  doc: FirebaseFirestore.QueryDocumentSnapshot
): Promise<void> {
  const message = doc.data() as MessageQueueDocument

  // Extract tenantId from the document path:
  // tenants/{tenantId}/whatsapp_campaigns/{campaignId}/message_queue/{docId}
  const pathParts = doc.ref.path.split('/')
  const tenantId = pathParts[1]
  const campaignId = pathParts[3]

  // Get the business account
  const accountSnap = await adminDb
    .collection(Collections.whatsappBusinessAccounts(tenantId))
    .doc(message.businessAccountId)
    .get()

  if (!accountSnap.exists) {
    await doc.ref.update({
      status: 'failed',
      failedAt: new Date().toISOString(),
      error: 'Business account not found',
      updatedAt: new Date().toISOString(),
    })
    await incrementCampaignCounter(tenantId, campaignId, 'messagesFailed')
    return
  }

  const account = accountSnap.data() as WhatsAppBusinessAccountDocument

  // Check if account is disconnected
  if (account.status === 'disconnected') {
    await doc.ref.update({
      status: 'failed',
      failedAt: new Date().toISOString(),
      error: 'WhatsApp Business account is disconnected',
      updatedAt: new Date().toISOString(),
    })
    await incrementCampaignCounter(tenantId, campaignId, 'messagesFailed')
    return
  }

  // Mark as processing (optimistic lock)
  // Only update if still pending to prevent double-processing
  const currentSnap = await doc.ref.get()
  const currentData = currentSnap.data() as MessageQueueDocument | undefined
  if (!currentData || currentData.status !== 'pending') {
    return // Another worker grabbed this message
  }

  await doc.ref.update({
    status: 'processing',
    attempts: FieldValue.increment(1),
    updatedAt: new Date().toISOString(),
  })

  try {
    // Decrypt access token
    const accessToken = decryptToken(account.accessToken)

    // Send message via WhatsApp API
    const sendResult = await sendTemplateMessage({
      phoneNumberId: account.phoneNumberId,
      accessToken,
      to: message.toPhoneNumber,
      templateName: message.templateName,
      language: message.templateLanguage,
      variables: message.templateVariables,
    })

    // Mark as sent
    await doc.ref.update({
      status: 'sent',
      messageId: sendResult.messageId,
      sentAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // Update campaign stats
    await incrementCampaignCounter(tenantId, campaignId, 'messagesSent')
  } catch (error) {
    const attempts = (message.attempts || 0) + 1
    const isLastAttempt = attempts >= message.maxAttempts
    let errorMessage = 'Unknown error'
    let errorCode = 'UNKNOWN'

    if (error instanceof WhatsAppAPIError) {
      errorMessage = error.message
      errorCode = error.code.toString()
    } else if (error instanceof Error) {
      errorMessage = error.message
    }

    // Update queue item
    const updateData: Record<string, any> = {
      status: isLastAttempt ? 'failed' : 'pending',
      error: `${errorCode}: ${errorMessage}`,
      updatedAt: new Date().toISOString(),
    }

    if (isLastAttempt) {
      updateData.failedAt = new Date().toISOString()
    }

    await doc.ref.update(updateData)

    // Update campaign stats if final failure
    if (isLastAttempt) {
      await incrementCampaignCounter(tenantId, campaignId, 'messagesFailed')
    }

    throw error
  }
}

/**
 * Increment a campaign counter field
 */
async function incrementCampaignCounter(
  tenantId: string,
  campaignId: string,
  field: 'messagesSent' | 'messagesFailed' | 'messagesDelivered' | 'messagesRead'
): Promise<void> {
  const campaignRef = adminDb
    .collection(Collections.whatsappCampaigns(tenantId))
    .doc(campaignId)

  const updateData: Record<string, any> = {
    [field]: FieldValue.increment(1),
    messagesPending: FieldValue.increment(-1),
    updatedAt: new Date().toISOString(),
  }

  await campaignRef.update(updateData)
}

/**
 * Process queue for a specific campaign
 * Used when resuming a paused campaign
 */
export async function processCampaignQueue(
  tenantId: string,
  campaignId: string,
  batchSize: number = 20
): Promise<ProcessResult> {
  const result: ProcessResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  }

  try {
    // Fetch pending messages for this campaign only
    const messagesSnap = await adminDb
      .collection(Collections.messageQueue(tenantId, campaignId))
      .where('status', '==', 'pending')
      .orderBy('createdAt')
      .limit(batchSize)
      .get()

    if (messagesSnap.empty) {
      return result
    }

    // Process each message
    for (const doc of messagesSnap.docs) {
      try {
        await processQueueItem(doc)
        result.succeeded++
      } catch (error) {
        console.error(`Failed to process queue item ${doc.id}:`, error)
        result.failed++
      }
      result.processed++
    }

    return result
  } catch (error) {
    console.error('Campaign queue processing error:', error)
    throw error
  }
}

/**
 * Get queue statistics for a specific campaign
 */
export async function getQueueStats(
  tenantId: string,
  campaignId: string
): Promise<{
  pending: number
  processing: number
  sent: number
  failed: number
  total: number
}> {
  const collRef = adminDb.collection(
    Collections.messageQueue(tenantId, campaignId)
  )

  // Run count queries in parallel for each status
  const [pendingSnap, processingSnap, sentSnap, failedSnap, totalSnap] =
    await Promise.all([
      collRef.where('status', '==', 'pending').count().get(),
      collRef.where('status', '==', 'processing').count().get(),
      collRef.where('status', 'in', ['sent', 'delivered', 'read']).count().get(),
      collRef.where('status', '==', 'failed').count().get(),
      collRef.count().get(),
    ])

  return {
    pending: pendingSnap.data().count,
    processing: processingSnap.data().count,
    sent: sentSnap.data().count,
    failed: failedSnap.data().count,
    total: totalSnap.data().count,
  }
}

/**
 * Clear old processed messages
 * Should be run periodically to clean up the queue
 *
 * @param tenantId Tenant ID
 * @param campaignId Campaign ID
 * @param olderThanDays Delete messages older than X days (default: 30)
 */
export async function clearOldQueueItems(
  tenantId: string,
  campaignId: string,
  olderThanDays: number = 30
): Promise<number> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

  const snap = await adminDb
    .collection(Collections.messageQueue(tenantId, campaignId))
    .where('status', 'in', ['sent', 'delivered', 'read', 'failed', 'cancelled'])
    .where('createdAt', '<', cutoffDate.toISOString())
    .get()

  if (snap.empty) {
    return 0
  }

  // Delete in batches of 500
  const batchSize = 500
  const docs = snap.docs
  for (let i = 0; i < docs.length; i += batchSize) {
    const batchDocs = docs.slice(i, i + batchSize)
    const writeBatch = adminDb.batch()
    for (const doc of batchDocs) {
      writeBatch.delete(doc.ref)
    }
    await writeBatch.commit()
  }

  return docs.length
}
