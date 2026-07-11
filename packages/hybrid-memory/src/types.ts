// ─── Scope ───────────────────────────────────────────────────────────────────
// Generic scope model — map your domain onto these:
//   scopeId    = orgId / tenantId / agentId / workspaceId
//   subScopeId = userId / contactId / memberId  (null = applies to all members)

export type MemoryScope = 'org' | 'member'

export interface EngineContext {
  conversationId: string
  scopeId: string
  subScopeId?: string | null
  agentId?: string | null
}

// ─── Presence classes ─────────────────────────────────────────────────────────
// omnipresent    → always injected (communication prefs, user profile)
// pattern        → injected when trigger terms appear in the message
// on-demand      → only via explicit tool call / agent-retrieve

export type PresenceClass = 'omnipresent' | 'pattern' | 'on-demand'

// ─── Memory categories (from simple-engram, extended) ────────────────────────

export type MemoryCategory = 'fact' | 'preference' | 'skill' | 'episode' | 'context' | 'procedure'

// ─── Core Memory record ───────────────────────────────────────────────────────
// Superset of simple-engram's Memory — backward-compatible additions marked //+

export interface HybridMemory {
  id: string
  content: string
  category: MemoryCategory
  source?: string

  // Scoring (from simple-engram)
  importance: number
  surprise: number
  accessCount: number
  lastAccessed: Date
  createdAt: Date
  embedding?: number[]
  metadata?: Record<string, unknown>
  expiresAt?: Date
  version: number
  history?: Array<{ content: string; changedAt: Date }>

  // + Tree navigation
  key: string                         // e.g. "/preferences/style"
  description: string                 // short ToC label

  // + Retrieval class
  presenceClass: PresenceClass
  triggerPatterns?: string[]          // only for 'pattern' class

  // + Scope
  scope: MemoryScope
  scopeId: string
  subScopeId?: string | null
}

export type NewHybridMemory = Omit<HybridMemory, 'id' | 'version' | 'accessCount' | 'lastAccessed' | 'createdAt'>

// ─── Observations (Stage 1 output) ───────────────────────────────────────────

export type ObservationStatus = 'new' | 'deferred' | 'consolidated' | 'discarded'

export interface Observation {
  id: string
  conversationId: string
  scopeId: string
  subScopeId?: string | null
  statement: string
  statementEmbedding?: number[]
  evidence: string
  evidenceEmbedding?: number[]
  status: ObservationStatus
  createdAt: Date
}

export type NewObservation = Omit<Observation, 'id' | 'createdAt' | 'status'>

// ─── Memory mutations (Stage 2 output / explicit capture output) ──────────────

export type MutationOperation = 'add' | 'modify' | 'delete'
export type MutationApprover = 'member' | 'org-admin'
export type MutationStatus = 'pending' | 'approved' | 'rejected'

export type MemoryMutation =
  | {
      operation: 'add'
      memory: NewHybridMemory
    }
  | {
      operation: 'modify'
      memoryId: string
      patch: Partial<Pick<HybridMemory, 'content' | 'key' | 'description' | 'presenceClass' | 'triggerPatterns' | 'importance'>>
    }
  | {
      operation: 'delete'
      memoryId: string
    }

export interface PendingMutation {
  id: string
  scopeId: string
  subScopeId?: string | null
  mutation: MemoryMutation
  approver: MutationApprover
  status: MutationStatus
  sourceObservationIds?: string[]
  createdAt: Date
  resolvedAt?: Date
}

// ─── Recall result ────────────────────────────────────────────────────────────

export interface RecallResult {
  omnipresent: HybridMemory[]
  pattern: HybridMemory[]
  searched: HybridMemory[]          // from vector search (on-demand excluded)
  contextBlock: string              // ready-to-inject serialized tree
}

// ─── Conversation reference (for idle detection) ──────────────────────────────

export interface ConversationRef {
  conversationId: string
  scopeId: string
  subScopeId?: string | null
  lastActivityAt: Date
}

export interface MessageChunk {
  messageId: string
  content: string
  conversationId: string
  similarity: number
}

// ─── Engine options ───────────────────────────────────────────────────────────

export interface HybridEngramOptions {
  // From simple-engram
  surpriseThreshold?: number          // default 0.3
  decayHalfLifeDays?: number          // default 30
  maxRetentionDays?: number           // default 90
  maxMemories?: number                // default 10_000
  defaultK?: number                   // default 5

  // Hybrid additions
  cooldownMs?: number                 // idle threshold before Stage 1 (default 2h)
  observationNeighbors?: number       // k_o — sibling observations to fetch (default 5)
  messageNeighbors?: number           // k_m — message chunks to fetch (default 10)
  maxOmnipresentTokens?: number       // cap injected omnipresent text (default 500)
  autoApprove?: boolean               // skip approval queue (default false)
}
