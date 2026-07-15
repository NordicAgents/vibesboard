// Unit tests for the hybrid recall() function.
//
// Uses InMemoryHybridStore (zero-config, no mocking needed) and a trivial
// mock embedder that always returns the same unit vector. This covers all
// three presence-class tiers (omnipresent / pattern / on-demand) plus the
// org-wide (includeOrgWide) scoping logic.
import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID as uuid } from 'node:crypto'
import { recall } from '../retrieval/recall.ts'
import { InMemoryHybridStore } from '../stores/in-memory.ts'
import type { HybridMemory, EngineContext } from '../types.ts'
import type { RecallOptions } from '../retrieval/recall.ts'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockEmbedder = {
  embed: async (_text: string): Promise<number[]> => [1, 0, 0],
  embedBatch: async (texts: string[]): Promise<number[][]> =>
    texts.map(() => [1, 0, 0]),
}

function makeMemory(overrides: Partial<HybridMemory> = {}): HybridMemory {
  return {
    id: uuid(),
    scopeId: 'agent-1',
    subScopeId: null,
    scope: 'org',
    key: '/test/memory',
    description: 'A test memory',
    content: 'Default test content',
    category: 'fact',
    presenceClass: 'omnipresent',
    importance: 0.7,
    surprise: 0,
    accessCount: 0,
    lastAccessed: new Date(),
    version: 1,
    createdAt: new Date(),
    ...overrides,
  }
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('recall()', () => {
  let store: InMemoryHybridStore
  let opts: RecallOptions

  beforeEach(() => {
    store = new InMemoryHybridStore()
    opts = {
      embedder: mockEmbedder,
      store,
      defaultK: 5,
      maxOmnipresentTokens: 500,
    }
  })

  // ── includeOrgWide scoping ─────────────────────────────────────────────────

  it('includeOrgWide — org-wide memories are returned for member context', async () => {
    // Org-wide omnipresent memory (subScopeId: null → applies to all members)
    await store.saveMemory(
      makeMemory({ subScopeId: null, scopeId: 'agent-1', presenceClass: 'omnipresent' }),
    )

    const ctx: EngineContext = {
      conversationId: 'c1',
      scopeId: 'agent-1',
      subScopeId: 'visitor-x',
    }
    const result = await recall('hello', ctx, opts)

    // The org-wide memory must be surfaced for this member's context
    expect(result.omnipresent).toHaveLength(1)
  })

  it('includeOrgWide — org scope query (no subScopeId) only returns org-wide, not member-specific', async () => {
    await store.saveMemory(
      makeMemory({ subScopeId: null, scopeId: 'agent-1', presenceClass: 'omnipresent' }),
    )
    await store.saveMemory(
      makeMemory({ subScopeId: 'visitor-y', scopeId: 'agent-1', presenceClass: 'omnipresent' }),
    )

    // No subScopeId → org-scope query, includeOrgWide is false
    const ctx: EngineContext = { conversationId: 'c1', scopeId: 'agent-1' }
    const result = await recall('hello', ctx, opts)

    // Only the org-wide memory is returned; visitor-y's memory is not
    expect(result.omnipresent).toHaveLength(1)
    expect(result.omnipresent[0].subScopeId).toBeNull()
    expect(result.omnipresent.find(m => m.subScopeId === 'visitor-y')).toBeUndefined()
  })

  // ── Pattern trigger matching ───────────────────────────────────────────────

  it('pattern trigger matching — case-insensitive includes match', async () => {
    await store.saveMemory(
      makeMemory({
        presenceClass: 'pattern',
        triggerPatterns: ['billing', 'invoice'],
        key: '/billing/plan',
        description: 'Billing plan details',
        content: 'The user is on the Pro plan.',
      }),
    )

    const ctx: EngineContext = { conversationId: 'c1', scopeId: 'agent-1' }
    // 'Billing' (capitalised) should match 'billing' case-insensitively
    const result = await recall('what is my Billing plan?', ctx, opts)

    expect(result.pattern).toHaveLength(1)
    expect(result.pattern[0].key).toBe('/billing/plan')
  })

  it('pattern trigger not matched — non-matching query excludes the memory', async () => {
    await store.saveMemory(
      makeMemory({
        presenceClass: 'pattern',
        triggerPatterns: ['billing', 'invoice'],
        key: '/billing/plan',
        description: 'Billing plan details',
        content: 'The user is on the Pro plan.',
      }),
    )

    const ctx: EngineContext = { conversationId: 'c1', scopeId: 'agent-1' }
    const result = await recall('how do I reset my password?', ctx, opts)

    expect(result.pattern).toHaveLength(0)
  })

  // ── On-demand vector search ────────────────────────────────────────────────

  it('on-demand memory is returned via vector search', async () => {
    // embedding [1,0,0] gives cosine (dot product) similarity of 1.0 with the
    // query embedding that mockEmbedder also returns as [1,0,0]
    await store.saveMemory(
      makeMemory({
        presenceClass: 'on-demand',
        key: '/runbooks/reset',
        description: 'Password reset runbook',
        content: 'To reset a password: go to settings → security.',
        embedding: [1, 0, 0],
      }),
    )

    const ctx: EngineContext = { conversationId: 'c1', scopeId: 'agent-1' }
    const result = await recall('how do I reset my password?', ctx, opts)

    expect(result.searched).toHaveLength(1)
    expect(result.searched[0].key).toBe('/runbooks/reset')
  })

  // ── Empty store ────────────────────────────────────────────────────────────

  it('does not throw with an empty store, and returns an empty contextBlock', async () => {
    const ctx: EngineContext = { conversationId: 'c1', scopeId: 'agent-1' }
    const result = await recall('anything', ctx, opts)

    expect(result.omnipresent).toHaveLength(0)
    expect(result.pattern).toHaveLength(0)
    expect(result.searched).toHaveLength(0)
    expect(result.contextBlock).toBe('')
  })

  // ── All three tiers combined ───────────────────────────────────────────────

  it('returns memories from all three presence classes in a single recall', async () => {
    // Omnipresent — org-wide so it is returned when subScopeId is set (includeOrgWide: true)
    await store.saveMemory(
      makeMemory({
        presenceClass: 'omnipresent',
        subScopeId: null,
        key: '/profile/name',
        description: 'User name',
        content: 'The user is called Alice.',
      }),
    )

    // Pattern — triggered by 'billing' in the query
    await store.saveMemory(
      makeMemory({
        presenceClass: 'pattern',
        subScopeId: null,
        triggerPatterns: ['billing'],
        key: '/billing/plan',
        description: 'Billing plan details',
        content: 'Pro plan, monthly.',
      }),
    )

    // On-demand — retrieved via vector search ([1,0,0] matches query embedding)
    await store.saveMemory(
      makeMemory({
        presenceClass: 'on-demand',
        subScopeId: null,
        key: '/runbooks/reset',
        description: 'Password reset runbook',
        content: 'Go to settings → security.',
        embedding: [1, 0, 0],
      }),
    )

    // subScopeId is set → includeOrgWide: true, which surfaces the org-wide memories above
    const ctx: EngineContext = {
      conversationId: 'c1',
      scopeId: 'agent-1',
      subScopeId: 'visitor-x',
    }
    const result = await recall('what is my billing plan?', ctx, opts)

    expect(result.omnipresent).toHaveLength(1)
    expect(result.pattern).toHaveLength(1)
    expect(result.searched).toHaveLength(1)
    // All three tiers contributed — contextBlock must be non-empty
    expect(result.contextBlock.length).toBeGreaterThan(0)
  })
})
