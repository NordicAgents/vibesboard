import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  Collections,
  type MessageTemplateDocument,
  type TemplateButton,
  type WhatsAppBusinessAccountDocument,
} from '@/lib/firestore-types'
import { decryptToken } from './business-accounts'

/**
 * WhatsApp Message Template Management
 *
 * Handles creation, submission, and synchronization of WhatsApp message templates:
 * - Create templates with variables, buttons, and media
 * - Submit to Meta for approval
 * - Sync approval status
 * - List approved templates for campaigns
 */

// =====================================================
// Types & Interfaces
// =====================================================

export interface CreateTemplateParams {
  businessAccountId: string
  name: string
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  language: string
  bodyText: string
  headerType?: 'text' | 'image' | 'video' | 'document'
  headerText?: string
  headerMediaUrl?: string
  footerText?: string
  variables?: string[]
  buttons?: TemplateButton[]
}

export type MessageTemplate = MessageTemplateDocument

// Re-export TemplateButton from firestore-types
export type { TemplateButton }

// =====================================================
// Meta Graph API Integration
// =====================================================

/**
 * Submit template to Meta WhatsApp Business API
 * Builds template payload and sends to Meta for approval
 */
async function submitTemplateToMeta(params: {
  businessAccountId: string
  accessToken: string
  name: string
  category: string
  language: string
  bodyText: string
  headerType?: string
  headerText?: string
  footerText?: string
  buttons?: TemplateButton[]
}): Promise<string> {
  const url = `https://graph.facebook.com/v18.0/${params.businessAccountId}/message_templates`

  const components: any[] = []

  // Header component
  if (params.headerType && params.headerText) {
    components.push({
      type: 'HEADER',
      format: params.headerType.toUpperCase(),
      text: params.headerText,
    })
  }

  // Body component
  components.push({
    type: 'BODY',
    text: params.bodyText,
  })

  // Footer component
  if (params.footerText) {
    components.push({
      type: 'FOOTER',
      text: params.footerText,
    })
  }

  // Buttons component
  if (params.buttons && params.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: params.buttons.map(btn => ({
        type: btn.type.toUpperCase(),
        text: btn.text,
        ...(btn.url && { url: btn.url }),
        ...(btn.phoneNumber && { phone_number: btn.phoneNumber }),
      })),
    })
  }

  const payload = {
    name: params.name,
    language: params.language,
    category: params.category,
    components,
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(
      `Meta API Error: ${data.error?.message || 'Unknown error'} (Code: ${data.error?.code || 'N/A'})`
    )
  }

  return data.id // Meta's template ID
}

/**
 * Fetch template status from Meta
 */
async function fetchTemplateFromMeta(
  metaTemplateId: string,
  accessToken: string
): Promise<any> {
  const url = `https://graph.facebook.com/v18.0/${metaTemplateId}`

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(
      `Meta API Error: ${data.error?.message || 'Unknown error'} (Code: ${data.error?.code || 'N/A'})`
    )
  }

  return data
}

// =====================================================
// Template Operations
// =====================================================

/**
 * Create message template and submit to Meta for approval
 *
 * Steps:
 * 1. Get business account
 * 2. Submit template to Meta
 * 3. Store in database
 */
export async function createMessageTemplate(
  tenantId: string,
  params: CreateTemplateParams
): Promise<MessageTemplate> {
  // 1. Get business account
  const accountSnap = await adminDb
    .collection(Collections.whatsappBusinessAccounts(tenantId))
    .doc(params.businessAccountId)
    .get()

  if (!accountSnap.exists) {
    throw new Error('Business account not found')
  }

  const account = accountSnap.data() as WhatsAppBusinessAccountDocument

  // 2. Submit to Meta
  const accessToken = decryptToken(account.accessToken)
  const metaTemplateId = await submitTemplateToMeta({
    businessAccountId: account.businessAccountId,
    accessToken,
    ...params,
  })

  // 3. Check for duplicate name+language
  const collRef = adminDb.collection(
    Collections.templates(tenantId, params.businessAccountId)
  )

  const existingSnap = await collRef
    .where('name', '==', params.name)
    .where('language', '==', params.language)
    .limit(1)
    .get()

  if (!existingSnap.empty) {
    throw new Error(
      'A template with this name and language already exists for this account.'
    )
  }

  // 4. Store in database
  const now = new Date().toISOString()
  const docRef = collRef.doc()
  const template: MessageTemplate = {
    id: docRef.id,
    businessAccountId: params.businessAccountId,
    name: params.name,
    language: params.language,
    category: params.category,
    headerType: params.headerType,
    headerText: params.headerText,
    headerMediaUrl: params.headerMediaUrl,
    bodyText: params.bodyText,
    footerText: params.footerText,
    variables: params.variables || [],
    buttons: params.buttons || [],
    status: 'pending',
    metaTemplateId,
    totalSent: 0,
    createdAt: now,
    updatedAt: now,
  }

  await docRef.set(template)

  return template
}

/**
 * Sync template status from Meta
 * Updates approval status and rejection reason if applicable
 */
export async function syncTemplateStatus(
  tenantId: string,
  businessAccountId: string,
  templateId: string
): Promise<void> {
  // 1. Get template
  const templateRef = adminDb
    .collection(Collections.templates(tenantId, businessAccountId))
    .doc(templateId)

  const templateSnap = await templateRef.get()
  if (!templateSnap.exists) {
    throw new Error('Template not found')
  }

  const template = templateSnap.data() as MessageTemplate

  if (!template.metaTemplateId) {
    throw new Error('Template has no Meta template ID')
  }

  // 2. Get business account for access token
  const accountSnap = await adminDb
    .collection(Collections.whatsappBusinessAccounts(tenantId))
    .doc(businessAccountId)
    .get()

  if (!accountSnap.exists) {
    throw new Error('Business account not found')
  }

  const account = accountSnap.data() as WhatsAppBusinessAccountDocument
  const accessToken = decryptToken(account.accessToken)

  // 3. Fetch from Meta
  const metaTemplate = await fetchTemplateFromMeta(
    template.metaTemplateId,
    accessToken
  )

  // 4. Update status
  const updateData: Record<string, any> = {
    status: metaTemplate.status.toLowerCase(),
    updatedAt: new Date().toISOString(),
  }

  if (metaTemplate.status === 'REJECTED') {
    updateData.rejectionReason =
      metaTemplate.rejected_reason || 'No reason provided'
  }

  await templateRef.update(updateData)
}

/**
 * Get approved templates for a business account
 * Used when creating campaigns
 */
export async function getApprovedTemplates(
  tenantId: string,
  businessAccountId: string
): Promise<MessageTemplate[]> {
  const snap = await adminDb
    .collection(Collections.templates(tenantId, businessAccountId))
    .where('status', '==', 'approved')
    .orderBy('createdAt', 'desc')
    .get()

  return snap.docs.map(doc => doc.data() as MessageTemplate)
}

/**
 * List all templates for a business account
 * Includes pending, approved, and rejected templates
 */
export async function listTemplates(
  tenantId: string,
  businessAccountId: string,
  status?: 'pending' | 'approved' | 'rejected'
): Promise<MessageTemplate[]> {
  let query: FirebaseFirestore.Query = adminDb.collection(
    Collections.templates(tenantId, businessAccountId)
  )

  if (status) {
    query = query.where('status', '==', status)
  }

  query = query.orderBy('createdAt', 'desc')

  const snap = await query.get()
  return snap.docs.map(doc => doc.data() as MessageTemplate)
}

/**
 * Get a single template by ID
 */
export async function getTemplateById(
  tenantId: string,
  businessAccountId: string,
  templateId: string
): Promise<MessageTemplate | null> {
  const snap = await adminDb
    .collection(Collections.templates(tenantId, businessAccountId))
    .doc(templateId)
    .get()

  if (!snap.exists) {
    return null
  }

  return snap.data() as MessageTemplate
}

/**
 * Delete a template
 * Note: Only deletes from database, not from Meta
 */
export async function deleteTemplate(
  tenantId: string,
  businessAccountId: string,
  templateId: string
): Promise<void> {
  await adminDb
    .collection(Collections.templates(tenantId, businessAccountId))
    .doc(templateId)
    .delete()
}

/**
 * Increment template usage counter
 * Called when template is used in a campaign
 */
export async function incrementTemplateUsage(
  tenantId: string,
  businessAccountId: string,
  templateId: string
): Promise<void> {
  try {
    await adminDb
      .collection(Collections.templates(tenantId, businessAccountId))
      .doc(templateId)
      .update({
        totalSent: FieldValue.increment(1),
        lastUsedAt: new Date().toISOString(),
      })
  } catch (error: any) {
    // Non-critical error, log but don't throw
    console.error('Failed to increment template usage:', error.message)
  }
}

/**
 * Extract variables from template body text
 * Finds all {{1}}, {{2}}, etc. placeholders
 */
export function extractVariablesFromBody(bodyText: string): number[] {
  const regex = /\{\{(\d+)\}\}/g
  const matches = [...bodyText.matchAll(regex)]
  return matches.map(match => parseInt(match[1])).sort((a, b) => a - b)
}

/**
 * Validate template before submission
 * Checks for common issues that would cause Meta rejection
 */
export function validateTemplate(params: CreateTemplateParams): {
  isValid: boolean
  errors: string[]
} {
  const errors: string[] = []

  // Check name format (lowercase, underscores only)
  if (!/^[a-z0-9_]+$/.test(params.name)) {
    errors.push(
      'Template name must contain only lowercase letters, numbers, and underscores'
    )
  }

  // Check body text length
  if (params.bodyText.length > 1024) {
    errors.push('Body text must be 1024 characters or less')
  }

  // Check for variables
  const variables = extractVariablesFromBody(params.bodyText)
  if (variables.length > 0) {
    // Ensure variables are sequential (1, 2, 3, not 1, 3, 4)
    const expectedVariables = Array.from(
      { length: variables.length },
      (_, i) => i + 1
    )
    if (JSON.stringify(variables) !== JSON.stringify(expectedVariables)) {
      errors.push(
        'Variables must be sequential ({{1}}, {{2}}, {{3}}, etc.)'
      )
    }

    // Ensure variable names are provided
    if (!params.variables || params.variables.length !== variables.length) {
      errors.push(
        'Variable names must match the number of variables in the body text'
      )
    }
  }

  // Check button count
  if (params.buttons && params.buttons.length > 3) {
    errors.push('Maximum 3 buttons allowed')
  }

  // Check button text length
  if (params.buttons) {
    params.buttons.forEach((btn, idx) => {
      if (btn.text.length > 20) {
        errors.push(
          `Button ${idx + 1} text must be 20 characters or less`
        )
      }
    })
  }

  // Check for promotional language (common rejection reasons)
  const promotionalKeywords = [
    'buy now',
    'limited time',
    'act fast',
    'hurry',
    'click here',
  ]
  const lowerBody = params.bodyText.toLowerCase()
  const foundKeywords = promotionalKeywords.filter(keyword =>
    lowerBody.includes(keyword)
  )
  if (foundKeywords.length > 0) {
    errors.push(
      `Avoid overly promotional language: "${foundKeywords.join('", "')}". This may cause rejection.`
    )
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}
