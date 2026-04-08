import { type Message } from '@/lib/types/message'

import { adminDb } from '@/lib/firebase/admin'
import { Collections, type AgentDocument } from '@/lib/firestore-types'
import {
  type AgentToolType,
  type BuiltinToolType,
  type VibeAgent,
  type VibeAgentConversation,
  type VibeAgentTool
} from '@/lib/types'
import { nanoid, slugify } from '@/lib/utils'
import { BUILTIN_AGENT_TOOLS } from './constants'

export { BUILTIN_AGENT_TOOLS }

const sanitizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === 'string')
}

const sanitizeMessages = (value: unknown): Message[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(
    (entry): entry is Message =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof entry.id === 'string' &&
      typeof entry.role === 'string' &&
      typeof entry.content === 'string'
  )
}

const sanitizeTools = (value: unknown): VibeAgentTool[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry): VibeAgentTool | null => {
      if (!entry || typeof entry !== 'object') {
        return null
      }

      const id = (entry as { id?: string }).id
      const name = (entry as { name?: string }).name
      const description = (entry as { description?: string }).description
      const config = (entry as { config?: Record<string, any> }).config
      const rawType = (entry as { type?: string }).type

      if (rawType?.startsWith('builtin:')) {
        // Silently drop removed tool types for backward compatibility
        if (rawType === 'builtin:web' || rawType === 'builtin:search') {
          return null
        }

        const type: BuiltinToolType | null =
          rawType in BUILTIN_AGENT_TOOLS
            ? (rawType as BuiltinToolType)
            : null

        if (!type) {
          return null
        }

        const builtin = BUILTIN_AGENT_TOOLS[type]

        return {
          ...builtin,
          id: type,
          type,
          name: name ?? builtin.name,
          description: description ?? builtin.description,
          config
        } satisfies VibeAgentTool
      }

      return null
    })
    .filter((tool): tool is VibeAgentTool => Boolean(tool))
}

/**
 * Map a Firestore agent document to the VibeAgent interface
 */
export const mapAgentDoc = (data: Record<string, any>): VibeAgent => ({
  id: data.id,
  userId: data.userId,
  tenantId: data.tenantId,
  tenantSlug: data.tenantSlug,
  name: data.name,
  instructions: data.instructions,
  fileKeys: sanitizeStringArray(data.fileKeys),
  agentUrl: data.agentUrl,
  tools: sanitizeTools(data.tools),
  allowAnonymous: data.allowAnonymous ?? false,
  greetingText: data.greetingText ?? null,
  mode: data.mode ?? 'provider',
  maxResponses: data.maxResponses ?? data.maxMessages ?? null,
  maxAgentResponses: data.maxAgentResponses ?? null,
  totalResponseCount: data.totalResponseCount ?? 0,
  quickSuggestionsMode: data.quickSuggestionsMode ?? 'off',
  quickSuggestionsCount: data.quickSuggestionsCount ?? 4,
  sourceUrls: sanitizeStringArray(data.sourceUrls),
  lastEmbeddingsSyncAt: data.lastEmbeddingsSyncAt ?? null,
  googleReviewEnabled: data.googleReviewEnabled ?? false,
  googlePlaceId: data.googlePlaceId ?? null,
  domain: data.domain ?? null,
  retrievalStrategy: data.retrievalStrategy ?? 'direct',
  notificationConfig: data.notificationConfig ?? undefined,
  handoffTargets: sanitizeStringArray(data.handoffTargets),
  collectionFields: Array.isArray(data.collectionFields) ? data.collectionFields : undefined,
  schedulingConfig: data.schedulingConfig ?? undefined,
  dataConfig: data.dataConfig ?? undefined,
  calendarAvailabilityConfig: data.calendarAvailabilityConfig ?? undefined,
  createdAt: data.createdAt,
  updatedAt: data.updatedAt
})

// Keep backward compat alias
export const mapAgentRow = mapAgentDoc

export const mapConversationDoc = (
  data: Record<string, any>
): VibeAgentConversation => ({
  id: data.id,
  agentId: data.agentId,
  userId: data.userId,
  externalId: data.externalId,
  summary: data.summary,
  messages: sanitizeMessages(data.messages),
  closedAt: data.closedAt ?? null,
  handedOff: data.handedOff ?? false,
  handoffChain: Array.isArray(data.handoffChain) ? data.handoffChain : undefined,
  responseCounts: typeof data.responseCounts === 'object' && data.responseCounts !== null
    ? data.responseCounts : undefined,
  summaryGeneratedAt: data.summaryGeneratedAt ?? null,
  summaryResponseCount: data.summaryResponseCount ?? undefined,
  createdAt: data.createdAt,
  updatedAt: data.updatedAt
})

export const mapConversationRow = mapConversationDoc

export const createAgentSlug = (name: string) => {
  const base = slugify(name)
  return base.length ? base : nanoid().toLowerCase()
}

/**
 * Ensure slug uniqueness within a tenant's agents collection.
 */
export const ensureUniqueSlug = async (
  slug: string,
  tenantId: string
) => {
  const collPath = Collections.agents(tenantId)
  let candidate = slug
  let attempt = 0

  while (attempt < 5) {
    const snapshot = await adminDb
      .collection(collPath)
      .where('agentUrl', '==', candidate)
      .limit(1)
      .get()

    if (snapshot.empty) {
      return candidate
    }

    candidate = `${slug}-${nanoid(3).toLowerCase()}`
    attempt += 1
  }

  return `${slug}-${nanoid(6).toLowerCase()}`
}
