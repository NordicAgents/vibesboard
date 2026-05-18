import { type Message } from '@vibesboard/contracts'

import { eq, and } from 'drizzle-orm'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { agents as agentsTable } from '@vibesboard/adapter-postgres/schema'
import { type AgentDocument } from '@vibesboard/contracts'
import {
  type AgentToolType,
  type BuiltinToolType,
  type VibeAgent,
  type VibeAgentConversation,
  type VibeAgentTool
} from '@vibesboard/contracts'
import { nanoid, slugify } from '@vibesboard/utils'
import { BUILTIN_AGENT_TOOLS } from './constants.ts'

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
          rawType in BUILTIN_AGENT_TOOLS ? (rawType as BuiltinToolType) : null

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
  accessPassword: data.accessPassword ?? null,
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
  collectionFields: Array.isArray(data.collectionFields)
    ? data.collectionFields
    : undefined,
  schedulingConfig: data.schedulingConfig ?? undefined,
  dataConfig: data.dataConfig ?? undefined,
  calendarAvailabilityConfig: data.calendarAvailabilityConfig ?? undefined,
  bookingConfig: data.bookingConfig ?? undefined,
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
  handoffChain: Array.isArray(data.handoffChain)
    ? data.handoffChain
    : undefined,
  responseCounts:
    typeof data.responseCounts === 'object' && data.responseCounts !== null
      ? data.responseCounts
      : undefined,
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
 * Ensure slug uniqueness within a tenant's agents table. Uses the BYPASSRLS
 * migrate role so the lookup runs without a current_tenant_id GUC context;
 * the (tenant_id, slug) tuple is filtered explicitly in the WHERE clause.
 */
export const ensureUniqueSlug = async (slug: string, tenantId: string) => {
  let candidate = slug
  let attempt = 0

  while (attempt < 5) {
    const rows = await getMigrateDb()
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(and(eq(agentsTable.tenantId, tenantId), eq(agentsTable.slug, candidate)))
      .limit(1)

    if (rows.length === 0) {
      return candidate
    }

    candidate = `${slug}-${nanoid(3).toLowerCase()}`
    attempt += 1
  }

  return `${slug}-${nanoid(6).toLowerCase()}`
}
