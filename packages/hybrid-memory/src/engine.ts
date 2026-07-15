import { randomUUID as uuid } from 'node:crypto'
import type { HybridStore, MutationFilter } from './interfaces/store.ts'
import type { LLMProvider } from './interfaces/llm.ts'
import type { Embedder } from './interfaces/embedder.ts'
import type {
  HybridMemory,
  NewHybridMemory,
  PendingMutation,
  RecallResult,
  EngineContext,
  HybridEngramOptions,
} from './types.ts'
import { recall as hybridRecall } from './retrieval/recall.ts'
import { captureMessage } from './pipeline/indiscriminate.ts'
import { runObservationFormation } from './pipeline/observe.ts'
import { runReconciliation } from './pipeline/reconcile.ts'
import { getPendingMutations, approveMutation, rejectMutation } from './approval.ts'
import { explicitCapturePrompt } from './prompts.ts'
import { serializeTreeToC } from './serializer.ts'

// simple-engram is a peer dep — import for its extraction + scoring logic
type SimpleEngram = {
  remember(messages: Array<{ role: string; content: string }>): Promise<unknown>
  forget(options?: { mode?: 'normal' | 'aggressive' }): Promise<void>
  merge(): Promise<void>
  stats(): Promise<unknown>
  export(format?: 'json' | 'markdown' | 'csv'): Promise<string>
  on(event: string, handler: (...args: unknown[]) => void): void
  off(event: string, handler: (...args: unknown[]) => void): void
}

export interface HybridEngramConfig {
  store: HybridStore
  llm: LLMProvider
  embedder: Embedder
  options?: HybridEngramOptions

  /**
   * Optional: pass a pre-configured simple-engram instance.
   * When provided, remember()/forget()/merge()/stats()/export()/on() delegate to it.
   * When omitted, these methods are no-ops until you wire them in.
   */
  base?: SimpleEngram
}

const DEFAULTS: Required<HybridEngramOptions> = {
  surpriseThreshold: 0.3,
  decayHalfLifeDays: 30,
  maxRetentionDays: 90,
  maxMemories: 10_000,
  defaultK: 5,
  cooldownMs: 2 * 60 * 60 * 1000,   // 2 hours
  observationNeighbors: 5,
  messageNeighbors: 10,
  maxDefers: 3,
  maxOmnipresentTokens: 500,
  autoApprove: false,
}

/**
 * HybridEngram — extended engram with full hybrid memory pipeline.
 *
 * Intersection of:
 *   - simple-engram: extraction, decay, merge, events, hooks (delegated to base)
 *   - hybrid design: omnipresent + pattern + cross-conversation reconciliation
 *
 * Usage:
 *   const engine = new HybridEngram({ store, llm, embedder, base: myEngram })
 *
 *   // In your AI handler — before response
 *   const { contextBlock } = await engine.recall(userMessage, ctx)
 *
 *   // After response — non-blocking
 *   engine.ingest(messageId, content, ctx).catch(console.error)
 *
 *   // Cron: Stage 1
 *   await engine.observe()
 *
 *   // Cron: Stage 2
 *   await engine.reconcile()
 */
export class HybridEngram {
  private store: HybridStore
  private llm: LLMProvider
  private embedder: Embedder
  private opts: Required<HybridEngramOptions>
  private base?: SimpleEngram

  constructor(config: HybridEngramConfig) {
    this.store = config.store
    this.llm = config.llm
    this.embedder = config.embedder
    this.opts = { ...DEFAULTS, ...config.options }
    this.base = config.base
  }

  // ── Runtime hooks ──────────────────────────────────────────────────────────

  /**
   * Recall memories relevant to the current query.
   * Returns all 3 tiers + a ready-to-inject contextBlock string.
   */
  async recall(query: string, ctx: EngineContext): Promise<RecallResult> {
    return hybridRecall(query, ctx, {
      embedder: this.embedder,
      store: this.store,
      defaultK: this.opts.defaultK,
      maxOmnipresentTokens: this.opts.maxOmnipresentTokens,
    })
  }

  /**
   * Embed and store a message for indiscriminate capture.
   * Call fire-and-forget after each message — non-blocking.
   */
  async ingest(messageId: string, content: string, ctx: EngineContext): Promise<void> {
    await captureMessage(messageId, content, ctx, {
      embedder: this.embedder,
      store: this.store,
    })
  }

  // ── Background jobs ────────────────────────────────────────────────────────

  /**
   * Stage 1 — Observation Formation.
   * Run from your cron/queue on idle conversations.
   */
  async observe(): Promise<{ conversationId: string; extracted: number }[]> {
    return runObservationFormation({
      llm: this.llm,
      embedder: this.embedder,
      store: this.store,
      cooldownMs: this.opts.cooldownMs,
    })
  }

  /**
   * Stage 2 — Observation Reconciliation.
   * Run after observe() — produces pending mutations or defers/discards.
   */
  async reconcile(): Promise<{ processed: number; mutated: number; deferred: number; discarded: number }> {
    return runReconciliation({
      llm: this.llm,
      store: this.store,
      embedder: this.embedder,
      observationNeighbors: this.opts.observationNeighbors,
      messageNeighbors: this.opts.messageNeighbors,
      maxDefers: this.opts.maxDefers,
      autoApprove: this.opts.autoApprove,
    })
  }

  // ── Explicit capture ───────────────────────────────────────────────────────

  /**
   * Propose a new memory from explicit agent/user input.
   * The LLM classifies it (key, description, presenceClass) before queuing.
   * Returns a PendingMutation awaiting approval (or auto-applied if autoApprove).
   */
  async propose(
    rawInput: string,
    ctx: EngineContext,
    overrides?: Partial<NewHybridMemory>,
  ): Promise<PendingMutation> {
    const existingMemories = await this.store.listMemories({ scopeId: ctx.scopeId })
    const toc = serializeTreeToC(existingMemories, { tocOnly: true })

    const raw = await this.llm.complete(explicitCapturePrompt(rawInput, toc), {
      maxTokens: 512,
      temperature: 0.2,
    })

    let classified: {
      key: string
      description: string
      presenceClass: HybridMemory['presenceClass']
      triggerPatterns: string[]
      content: string
    }

    try {
      classified = JSON.parse(raw.trim())
    } catch {
      classified = {
        key: '/misc/note',
        description: rawInput.slice(0, 80),
        presenceClass: 'on-demand',
        triggerPatterns: [],
        content: rawInput,
      }
    }

    const newMemory: NewHybridMemory = {
      content: classified.content,
      category: 'context',
      importance: 0.7,
      surprise: 0,
      key: classified.key,
      description: classified.description,
      presenceClass: classified.presenceClass,
      triggerPatterns: classified.triggerPatterns,
      scope: ctx.subScopeId ? 'member' : 'org',
      scopeId: ctx.scopeId,
      subScopeId: ctx.subScopeId ?? null,
      ...overrides,
    }

    const mutation: PendingMutation = {
      id: uuid(),
      scopeId: ctx.scopeId,
      subScopeId: ctx.subScopeId ?? null,
      mutation: { operation: 'add', memory: newMemory },
      approver: ctx.subScopeId ? 'member' : 'org-admin',
      status: this.opts.autoApprove ? 'approved' : 'pending',
      createdAt: new Date(),
    }

    await this.store.saveMutation(mutation)

    if (this.opts.autoApprove) {
      const embedding = await this.embedder.embed(newMemory.content)
      const mem: HybridMemory = {
        id: uuid(),
        ...newMemory,
        embedding,
        version: 1,
        accessCount: 0,
        lastAccessed: new Date(),
        createdAt: new Date(),
      }
      await this.store.saveMemory(mem)
    }

    return mutation
  }

  // ── Approval queue ─────────────────────────────────────────────────────────

  async getPending(filter: MutationFilter): Promise<PendingMutation[]> {
    return getPendingMutations(filter, this.store)
  }

  async approve(mutationId: string): Promise<void> {
    return approveMutation(mutationId, this.store, this.embedder)
  }

  async reject(mutationId: string): Promise<void> {
    return rejectMutation(mutationId, this.store)
  }

  // ── Delegated to simple-engram ─────────────────────────────────────────────
  // These use simple-engram's battle-tested implementation when base is provided.

  /**
   * Extract memories from a conversation using simple-engram's LLM pipeline.
   * Use this for single-conversation extraction before the reflective pipeline fires.
   */
  async remember(messages: Array<{ role: string; content: string }>): Promise<unknown> {
    return this.base?.remember(messages)
  }

  /**
   * Prune expired / low-importance memories (Ebbinghaus decay from simple-engram).
   */
  async forget(options?: { mode?: 'normal' | 'aggressive' }): Promise<void> {
    return this.base?.forget(options)
  }

  /**
   * Consolidate near-duplicate memories (0.85 cosine threshold, from simple-engram).
   */
  async merge(): Promise<void> {
    return this.base?.merge()
  }

  /** Aggregated memory metrics from simple-engram. */
  async stats(): Promise<unknown> {
    return this.base?.stats()
  }

  /** Export memories as JSON / Markdown / CSV (from simple-engram). */
  async export(format: 'json' | 'markdown' | 'csv' = 'json'): Promise<string> {
    return this.base?.export(format) ?? '{}'
  }

  /** Forward events from simple-engram (stored, recalled, rejected, forgotten, merged). */
  on(event: string, handler: (...args: unknown[]) => void): void {
    this.base?.on(event, handler)
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.base?.off(event, handler)
  }
}
