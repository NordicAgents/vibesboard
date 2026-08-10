import { type Message } from '@vibesboard/contracts'

import { eq, and } from 'drizzle-orm'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { agents as agentsTable } from '@vibesboard/adapter-postgres/schema'
import type {
  Agent,
  Conversation,
  Message as MessageRow,
  ConversationFeedbackRow,
  Hook,
  HookJob
} from '@vibesboard/adapter-postgres/schema'
import type {
  HookDocument,
  HookJobDocument
} from '@vibesboard/contracts'
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

/** Agent mapper output contains only the public password-presence boolean. */
type MappedAgent = VibeAgent

/**
 * Map a raw agent record to the VibeAgent interface
 */
export const mapAgentDoc = (data: Record<string, any>): MappedAgent => ({
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
  // Boolean only: this mapper's output is returned verbatim by GET/POST
  // /api/agents, so echoing the hash back would hand it to every member of the
  // tenant (and to super-admins listing another tenant's agents). No caller of
  // this mapper needs the hash itself.
  hasAccessPassword: Boolean(
    data.hasAccessPassword ?? data.accessPassword ?? data.accessPasswordHash
  ),
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
  llmConfigId: data.llmConfigId ?? null,
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

export const messageRowToMessage = (row: MessageRow): Message => ({
  id: row.id,
  role: row.role as Message['role'],
  content: row.content
})

export const rowToConversation = (
  row: Conversation,
  messageRows: MessageRow[],
  feedback: ConversationFeedbackRow | null
): VibeAgentConversation => ({
  id: row.id,
  agentId: row.agentId,
  userId: row.userId,
  externalId: row.externalId,
  summary: row.summary ?? null,
  messages: messageRows.map(messageRowToMessage),
  closedAt: row.closedAt ? row.closedAt.toISOString() : null,
  handedOff: row.handedOff ?? false,
  handoffChain: Array.isArray(row.handoffChain) ? row.handoffChain : undefined,
  responseCounts: row.responseCounts ?? undefined,
  summaryGeneratedAt: row.summaryGeneratedAt
    ? row.summaryGeneratedAt.toISOString()
    : null,
  summaryResponseCount: row.summaryResponseCount ?? undefined,
  feedback: feedback
    ? {
        rating: feedback.rating,
        comment: feedback.comment ?? undefined,
        createdAt: feedback.createdAt.toISOString()
      }
    : undefined,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString()
})

/** Mark an agent's conversation embeddings as synced at the given time. */
export const setAgentEmbeddingsSyncedAt = async (
  agentId: string,
  when: Date,
  db = getMigrateDb()
): Promise<void> => {
  await db
    .update(agentsTable)
    .set({ lastEmbeddingsSyncAt: when, updatedAt: when })
    .where(eq(agentsTable.id, agentId))
}

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

/** Map a Postgres hooks row to the legacy HookDocument shape. */
export const rowToHook = (r: Hook): HookDocument => ({
  id: r.id,
  agentId: r.agentId,
  tenantId: r.tenantId,
  name: r.name,
  secretHash: r.secretHash,
  status: r.status,
  requestCount: r.requestCount,
  lastUsedAt: r.lastUsedAt?.toISOString() ?? undefined,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString()
})

/** Map a hooks row to HookDocument with the secretHash stripped. */
export const rowToHookSafe = (r: Hook): Omit<HookDocument, 'secretHash'> => {
  const { secretHash: _secretHash, ...safe } = rowToHook(r)
  return safe
}

/** Collapse a nullable value to undefined (null → undefined, value → value). */
const orUndefined = <T>(value: T | null): T | undefined => value ?? undefined

/** Collapse a nullable timestamp to an ISO string or undefined. */
const isoOrUndefined = (value: Date | null): string | undefined =>
  value ? value.toISOString() : undefined

/** Map a Postgres hook_jobs row to the legacy HookJobDocument shape. */
export const rowToHookJob = (r: HookJob): HookJobDocument => ({
  id: r.id,
  hookId: r.hookId,
  agentId: r.agentId,
  tenantId: r.tenantId,
  message: r.message,
  externalUserId: orUndefined(r.externalUserId),
  conversationId: orUndefined(r.conversationId),
  callbackUrl: r.callbackUrl,
  status: r.status,
  reply: orUndefined(r.reply),
  error: orUndefined(r.error),
  callbackStatus: orUndefined(r.callbackStatus),
  callbackAttempts: r.callbackAttempts,
  createdAt: r.createdAt.toISOString(),
  startedAt: isoOrUndefined(r.startedAt),
  completedAt: isoOrUndefined(r.completedAt),
  failedAt: isoOrUndefined(r.failedAt)
})

/** Map a Postgres agents row (+ the tenant's slug) to the VibeAgent shape. */
export const agentRowToVibeAgent = (row: Agent, tenantSlug: string): MappedAgent => ({
  id: row.id,
  userId: row.userId ?? '',
  tenantId: row.tenantId,
  tenantSlug,
  name: row.name,
  instructions: row.instructions,
  fileKeys: row.fileKeys ?? [],
  agentUrl: row.slug,
  tools: sanitizeTools(row.tools ?? []),
  allowAnonymous: row.allowAnonymous ?? false,
  // Boolean only — the raw hash is deliberately NOT mapped. The gated pages
  // ([tenantSlug]/[agentSlug] and widget/[agentId]) pass the whole agent into a
  // client component, so anything here reaches anonymous visitors in the RSC
  // payload. The one server-side caller that genuinely needs the hash (the
  // verify-access route) reads it via getAgentAccessPasswordHash().
  hasAccessPassword: Boolean(row.accessPasswordHash),
  greetingText: row.greetingText ?? null,
  mode: row.mode ?? 'provider',
  maxResponses: row.maxResponses ?? null,
  maxAgentResponses: row.maxAgentResponses ?? null,
  totalResponseCount: row.totalResponseCount ?? 0,
  quickSuggestionsMode: row.quickSuggestionsMode ?? 'off',
  quickSuggestionsCount: row.quickSuggestionsCount ?? 4,
  sourceUrls: [],
  lastEmbeddingsSyncAt: row.lastEmbeddingsSyncAt?.toISOString() ?? null,
  googleReviewEnabled: row.googleReviewEnabled ?? false,
  googlePlaceId: row.googlePlaceId ?? null,
  domain: null,
  retrievalStrategy: row.retrievalStrategy ?? 'direct',
  notificationConfig: row.notificationConfig ?? undefined,
  handoffTargets: row.handoffTargets ?? [],
  collectionFields: row.collectionFields ?? undefined,
  schedulingConfig: row.schedulingConfig ?? undefined,
  dataConfig: (row.dataConfig as unknown) as VibeAgent['dataConfig'] ?? undefined,
  calendarAvailabilityConfig: row.calendarAvailabilityConfig ?? undefined,
  bookingConfig: row.bookingConfig ?? undefined,
  llmConfigId: row.llmConfigId ?? null,
  memoryEnabled: row.memoryEnabled ?? false,
  currentVersion: row.currentVersion ?? 1,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})
