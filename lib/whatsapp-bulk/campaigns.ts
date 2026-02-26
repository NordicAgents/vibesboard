import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  Collections,
  type WhatsAppCampaignDocument,
  type CampaignStatus,
  type MessageQueueDocument,
} from '@/lib/firestore-types'

/**
 * WhatsApp Campaign Management
 *
 * Handles campaign creation, scheduling, and analytics:
 * - Create campaigns with templates and target lists
 * - Start/pause/resume campaigns
 * - Queue messages for processing
 * - Track campaign statistics
 */

// =====================================================
// Types & Interfaces
// =====================================================

export interface CreateCampaignParams {
  tenantId: string
  businessAccountId: string
  name: string
  description?: string
  templateId: string
  templateVariables?: Record<string, string>
  contactListIds: string[]
  filterCriteria?: any
  scheduledAt?: Date
  maxMessagesPerSecond?: number
  userId: string
}

export type Campaign = WhatsAppCampaignDocument

export interface CampaignStats {
  campaign: Campaign
  deliveryRate: number
  readRate: number
  failureRate: number
  estimatedCompletion?: string
}

// =====================================================
// Campaign Operations
// =====================================================

/**
 * Create a new campaign
 */
export async function createCampaign(
  tenantId: string,
  params: CreateCampaignParams
): Promise<Campaign> {
  const collRef = adminDb.collection(Collections.whatsappCampaigns(tenantId))

  const now = new Date().toISOString()
  const docRef = collRef.doc()
  const campaign: Campaign = {
    id: docRef.id,
    tenantId,
    businessAccountId: params.businessAccountId,
    name: params.name,
    description: params.description,
    templateId: params.templateId,
    templateVariables: params.templateVariables || {},
    contactListIds: params.contactListIds,
    filterCriteria: params.filterCriteria,
    status: params.scheduledAt ? 'scheduled' : 'draft',
    scheduledAt: params.scheduledAt?.toISOString(),
    totalRecipients: 0,
    messagesSent: 0,
    messagesDelivered: 0,
    messagesRead: 0,
    messagesFailed: 0,
    messagesPending: 0,
    maxMessagesPerSecond: params.maxMessagesPerSecond || 20,
    createdBy: params.userId,
    createdAt: now,
    updatedAt: now,
  }

  await docRef.set(campaign)

  return campaign
}

/**
 * Start a campaign (queue all messages)
 */
export async function startCampaign(
  tenantId: string,
  campaignId: string
): Promise<void> {
  const campaignRef = adminDb
    .collection(Collections.whatsappCampaigns(tenantId))
    .doc(campaignId)

  // 1. Get campaign details
  const campaignSnap = await campaignRef.get()
  if (!campaignSnap.exists) {
    throw new Error('Campaign not found')
  }

  const campaign = campaignSnap.data() as Campaign

  if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
    throw new Error('Campaign must be in draft or scheduled status to start')
  }

  // 2. Get the template
  const templateSnap = await adminDb
    .collection(
      Collections.templates(tenantId, campaign.businessAccountId)
    )
    .doc(campaign.templateId)
    .get()

  const template = templateSnap.exists ? templateSnap.data() : null

  // 3. Get all contacts from specified lists (denormalized contactIds on list docs)
  const contactIds = new Set<string>()
  for (const listId of campaign.contactListIds) {
    const listSnap = await adminDb
      .collection(Collections.whatsappContactLists(tenantId))
      .doc(listId)
      .get()
    if (listSnap.exists) {
      const listData = listSnap.data()
      if (listData?.contactIds) {
        for (const id of listData.contactIds) {
          contactIds.add(id)
        }
      }
    }
  }

  // Fetch the actual contact documents and filter opted-in only
  const contacts: any[] = []
  const contactIdArray = Array.from(contactIds)

  // Fetch in batches of 30 (Firestore 'in' limit is 30)
  for (let i = 0; i < contactIdArray.length; i += 30) {
    const batch = contactIdArray.slice(i, i + 30)
    const snap = await adminDb
      .collection(Collections.whatsappContacts(tenantId))
      .where('id', 'in', batch)
      .get()
    snap.docs.forEach(doc => {
      const data = doc.data()
      if (data.optedIn) {
        contacts.push(data)
      }
    })
  }

  if (contacts.length === 0) {
    throw new Error('No opted-in contacts found in selected lists')
  }

  // 4. Update campaign status
  await campaignRef.update({
    status: 'sending',
    startedAt: new Date().toISOString(),
    totalRecipients: contacts.length,
    messagesPending: contacts.length,
    updatedAt: new Date().toISOString(),
  })

  // 5. Queue all messages
  const queueCollRef = adminDb.collection(
    Collections.messageQueue(tenantId, campaignId)
  )

  // Insert queue items in batches of 500 (Firestore batch limit)
  const batchSize = 500
  for (let i = 0; i < contacts.length; i += batchSize) {
    const batchItems = contacts.slice(i, i + batchSize)
    const writeBatch = adminDb.batch()

    for (const contact of batchItems) {
      const queueDocRef = queueCollRef.doc()
      const now = new Date().toISOString()
      const queueItem: MessageQueueDocument = {
        id: queueDocRef.id,
        campaignId,
        businessAccountId: campaign.businessAccountId,
        contactId: contact.id,
        toPhoneNumber: contact.phoneNumber,
        templateId: campaign.templateId,
        templateName: template?.name || '',
        templateLanguage: template?.language || 'en',
        templateVariables: {
          ...campaign.templateVariables,
          // Personalize with contact data
          customer_name: contact.name || 'Customer',
          ...contact.customFields,
        },
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        createdAt: now,
        updatedAt: now,
      }
      writeBatch.set(queueDocRef, queueItem)
    }

    await writeBatch.commit()
  }
}

/**
 * Pause campaign
 */
export async function pauseCampaign(
  tenantId: string,
  campaignId: string
): Promise<void> {
  const campaignRef = adminDb
    .collection(Collections.whatsappCampaigns(tenantId))
    .doc(campaignId)

  const snap = await campaignRef.get()
  if (!snap.exists) {
    throw new Error('Campaign not found')
  }

  const campaign = snap.data() as Campaign
  if (campaign.status !== 'sending') {
    throw new Error('Campaign must be in sending status to pause')
  }

  await campaignRef.update({
    status: 'paused',
    pausedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

/**
 * Resume campaign
 */
export async function resumeCampaign(
  tenantId: string,
  campaignId: string
): Promise<void> {
  const campaignRef = adminDb
    .collection(Collections.whatsappCampaigns(tenantId))
    .doc(campaignId)

  const snap = await campaignRef.get()
  if (!snap.exists) {
    throw new Error('Campaign not found')
  }

  const campaign = snap.data() as Campaign
  if (campaign.status !== 'paused') {
    throw new Error('Campaign must be in paused status to resume')
  }

  await campaignRef.update({
    status: 'sending',
    pausedAt: FieldValue.delete(),
    updatedAt: new Date().toISOString(),
  })
}

/**
 * Cancel campaign
 */
export async function cancelCampaign(
  tenantId: string,
  campaignId: string
): Promise<void> {
  const campaignRef = adminDb
    .collection(Collections.whatsappCampaigns(tenantId))
    .doc(campaignId)

  const snap = await campaignRef.get()
  if (!snap.exists) {
    throw new Error('Campaign not found')
  }

  const campaign = snap.data() as Campaign
  if (
    !['draft', 'scheduled', 'sending', 'paused'].includes(campaign.status)
  ) {
    throw new Error('Campaign cannot be cancelled in its current status')
  }

  // Update campaign status
  await campaignRef.update({
    status: 'cancelled',
    updatedAt: new Date().toISOString(),
  })

  // Cancel pending queue items
  const queueSnap = await adminDb
    .collection(Collections.messageQueue(tenantId, campaignId))
    .where('status', '==', 'pending')
    .get()

  // Update in batches of 500
  const batchSize = 500
  const docs = queueSnap.docs
  for (let i = 0; i < docs.length; i += batchSize) {
    const batchDocs = docs.slice(i, i + batchSize)
    const writeBatch = adminDb.batch()
    for (const doc of batchDocs) {
      writeBatch.update(doc.ref, {
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
      })
    }
    await writeBatch.commit()
  }
}

/**
 * Get campaign statistics
 */
export async function getCampaignStats(
  tenantId: string,
  campaignId: string
): Promise<CampaignStats> {
  const snap = await adminDb
    .collection(Collections.whatsappCampaigns(tenantId))
    .doc(campaignId)
    .get()

  if (!snap.exists) {
    throw new Error('Campaign not found')
  }

  const campaign = snap.data() as Campaign

  const deliveryRate =
    campaign.totalRecipients > 0
      ? (campaign.messagesDelivered / campaign.totalRecipients) * 100
      : 0

  const readRate =
    campaign.messagesDelivered > 0
      ? (campaign.messagesRead / campaign.messagesDelivered) * 100
      : 0

  const failureRate =
    campaign.totalRecipients > 0
      ? (campaign.messagesFailed / campaign.totalRecipients) * 100
      : 0

  // Estimate completion time
  let estimatedCompletion: string | undefined
  if (campaign.status === 'sending' && campaign.messagesPending > 0) {
    const messagesPerSecond = campaign.maxMessagesPerSecond || 20
    const secondsRemaining = campaign.messagesPending / messagesPerSecond
    const completionDate = new Date(Date.now() + secondsRemaining * 1000)
    estimatedCompletion = completionDate.toISOString()
  }

  return {
    campaign,
    deliveryRate,
    readRate,
    failureRate,
    estimatedCompletion,
  }
}

/**
 * List campaigns for a tenant
 */
export async function listCampaigns(
  tenantId: string,
  filters?: {
    status?: CampaignStatus
    limit?: number
    offset?: number
  }
): Promise<{ campaigns: Campaign[]; total: number }> {
  let query: FirebaseFirestore.Query = adminDb.collection(
    Collections.whatsappCampaigns(tenantId)
  )

  if (filters?.status) {
    query = query.where('status', '==', filters.status)
  }

  query = query.orderBy('createdAt', 'desc')

  // Get total count
  const countSnap = await query.count().get()
  const total = countSnap.data().count

  // Apply pagination
  if (filters?.offset) {
    query = query.offset(filters.offset)
  }

  if (filters?.limit) {
    query = query.limit(filters.limit)
  }

  const snap = await query.get()
  const campaigns = snap.docs.map(doc => doc.data() as Campaign)

  return { campaigns, total }
}

/**
 * Get a single campaign by ID
 */
export async function getCampaignById(
  tenantId: string,
  campaignId: string
): Promise<Campaign | null> {
  const snap = await adminDb
    .collection(Collections.whatsappCampaigns(tenantId))
    .doc(campaignId)
    .get()

  if (!snap.exists) {
    return null
  }

  return snap.data() as Campaign
}

/**
 * Delete campaign
 */
export async function deleteCampaign(
  tenantId: string,
  campaignId: string
): Promise<void> {
  const snap = await adminDb
    .collection(Collections.whatsappCampaigns(tenantId))
    .doc(campaignId)
    .get()

  if (snap.exists) {
    const campaign = snap.data() as Campaign
    if (campaign.status !== 'draft') {
      throw new Error('Can only delete draft campaigns')
    }
  }

  await adminDb
    .collection(Collections.whatsappCampaigns(tenantId))
    .doc(campaignId)
    .delete()
}

/**
 * Get queue items for a campaign
 */
export async function getCampaignQueueItems(
  tenantId: string,
  campaignId: string,
  filters?: {
    status?: string
    limit?: number
    offset?: number
  }
): Promise<MessageQueueDocument[]> {
  let query: FirebaseFirestore.Query = adminDb.collection(
    Collections.messageQueue(tenantId, campaignId)
  )

  if (filters?.status) {
    query = query.where('status', '==', filters.status)
  }

  query = query.orderBy('createdAt', 'desc')

  if (filters?.offset) {
    query = query.offset(filters.offset)
  }

  if (filters?.limit) {
    query = query.limit(filters.limit)
  }

  const snap = await query.get()
  return snap.docs.map(doc => doc.data() as MessageQueueDocument)
}
