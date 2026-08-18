import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID as uuid } from 'node:crypto'
import { InMemoryHybridStore } from '../stores/in-memory.ts'
import type { HybridMemory, Observation, EngineContext } from '../types.ts'

function makeMemory(overrides: Partial<HybridMemory> = {}): HybridMemory {
  return {
    id: uuid(),
    scopeId: 'org-1',
    subScopeId: null,
    scope: 'org',
    key: '/prefs/style',
    description: 'Test memory',
    content: 'User prefers concise responses',
    category: 'preference',
    presenceClass: 'pattern',
    triggerPatterns: ['style'],
    importance: 0.7,
    surprise: 0,
    accessCount: 0,
    lastAccessed: new Date(),
    version: 1,
    createdAt: new Date(),
    ...overrides,
  }
}

function makeObs(overrides: Partial<Observation> = {}): Observation {
  return {
    id: uuid(),
    conversationId: uuid(),
    scopeId: 'org-1',
    subScopeId: null,
    statement: 'User likes short answers',
    evidence: 'User said "keep it brief"',
    status: 'new',
    createdAt: new Date(),
    ...overrides,
  }
}

describe('InMemoryHybridStore', () => {
  let store: InMemoryHybridStore

  beforeEach(() => {
    store = new InMemoryHybridStore()
  })

  // ── Memories ──────────────────────────────────────────────────────────────

  it('saves and retrieves a memory', async () => {
    const mem = makeMemory()
    await store.saveMemory(mem)
    const got = await store.getMemory(mem.id)
    expect(got?.id).toBe(mem.id)
    expect(got?.content).toBe(mem.content)
  })

  it('listMemories filters by scopeId', async () => {
    await store.saveMemory(makeMemory({ scopeId: 'org-1' }))
    await store.saveMemory(makeMemory({ scopeId: 'org-2' }))
    const results = await store.listMemories({ scopeId: 'org-1' })
    expect(results).toHaveLength(1)
    expect(results[0].scopeId).toBe('org-1')
  })

  it('listMemories returns results sorted by importance descending', async () => {
    await store.saveMemory(makeMemory({ importance: 0.3 }))
    await store.saveMemory(makeMemory({ importance: 0.9 }))
    await store.saveMemory(makeMemory({ importance: 0.6 }))
    const results = await store.listMemories({ scopeId: 'org-1' })
    expect(results[0].importance).toBe(0.9)
    expect(results[2].importance).toBe(0.3)
  })

  it('listMemories with includeOrgWide returns both org-wide and member memories', async () => {
    await store.saveMemory(makeMemory({ subScopeId: null, scopeId: 'org-1' }))       // org-wide
    await store.saveMemory(makeMemory({ subScopeId: 'user-A', scopeId: 'org-1' }))   // member A
    await store.saveMemory(makeMemory({ subScopeId: 'user-B', scopeId: 'org-1' }))   // member B

    // Member A context with includeOrgWide should see org-wide + their own, not B's
    const results = await store.listMemories({ scopeId: 'org-1', subScopeId: 'user-A', includeOrgWide: true })
    expect(results).toHaveLength(2)
    expect(results.map(r => r.subScopeId).sort()).toEqual([null, 'user-A'].sort())
  })

  it('updateMemory patches and increments version', async () => {
    const mem = makeMemory()
    await store.saveMemory(mem)
    const updated = await store.updateMemory(mem.id, { content: 'Updated content' })
    expect(updated.content).toBe('Updated content')
    expect(updated.version).toBe(2)
  })

  it('updateMemory appends previous content to history on content change', async () => {
    const mem = makeMemory({ content: 'original' })
    await store.saveMemory(mem)
    const updated = await store.updateMemory(mem.id, { content: 'revised' })
    expect(updated.history).toHaveLength(1)
    expect(updated.history?.[0].content).toBe('original')
  })

  it('updateMemory does not bump version for metadata-only patches', async () => {
    const mem = makeMemory()
    await store.saveMemory(mem)
    const updated = await store.updateMemory(mem.id, { embedding: [1, 2, 3] })
    expect(updated.version).toBe(1)
    expect(updated.history ?? []).toHaveLength(0)
  })

  it('deleteMemory removes the memory', async () => {
    const mem = makeMemory()
    await store.saveMemory(mem)
    await store.deleteMemory(mem.id)
    expect(await store.getMemory(mem.id)).toBeNull()
  })

  // ── Observations ──────────────────────────────────────────────────────────

  it('saves and retrieves pending observations', async () => {
    await store.saveObservation(makeObs({ scopeId: 'org-1' }))
    await store.saveObservation(makeObs({ scopeId: 'org-1', status: 'consolidated' }))
    const pending = await store.getPendingObservations('org-1')
    expect(pending).toHaveLength(1)
    expect(pending[0].status).toBe('new')
  })

  it('updateObservationStatus changes status', async () => {
    const obs = makeObs()
    await store.saveObservation(obs)
    await store.updateObservationStatus(obs.id, 'deferred')
    const pending = await store.getPendingObservations('org-1')
    expect(pending[0].status).toBe('deferred')
  })

  it('deferring increments deferCount', async () => {
    const obs = makeObs()
    await store.saveObservation(obs)
    await store.updateObservationStatus(obs.id, 'deferred')
    await store.updateObservationStatus(obs.id, 'deferred')
    const pending = await store.getPendingObservations('org-1')
    expect(pending[0].deferCount).toBe(2)
  })

  it('getPendingObservations returns new observations before deferred ones', async () => {
    const older = new Date(Date.now() - 10_000)
    await store.saveObservation(makeObs({ status: 'deferred', createdAt: older }))
    const fresh = makeObs({ status: 'new' })
    await store.saveObservation(fresh)

    const pending = await store.getPendingObservations('org-1')
    expect(pending[0].id).toBe(fresh.id)
    expect(pending[1].status).toBe('deferred')
  })

  // ── Message embeddings / idle conversations ────────────────────────────────

  it('getIdleConversations returns conversations past cooldown', async () => {
    const oldDate = new Date(Date.now() - 10_000)
    const ctx: EngineContext = { conversationId: 'conv-1', scopeId: 'org-1' }
    await store.saveMessageEmbedding('msg-1', 'hello', [1, 0], ctx)
    // Hack the internal map to set an old timestamp
    const internal = (store as any).messageEmbeddings as Map<string, any>
    internal.get('msg-1').createdAt = oldDate

    const idle = await store.getIdleConversations(5_000) // 5s cooldown
    expect(idle).toHaveLength(1)
    expect(idle[0].conversationId).toBe('conv-1')
  })

  it('markConversationProcessed prevents it appearing as idle', async () => {
    const oldDate = new Date(Date.now() - 10_000)
    const ctx: EngineContext = { conversationId: 'conv-2', scopeId: 'org-1' }
    await store.saveMessageEmbedding('msg-2', 'hi', [0, 1], ctx)
    const internal = (store as any).messageEmbeddings as Map<string, any>
    internal.get('msg-2').createdAt = oldDate

    await store.markConversationProcessed('conv-2')
    const idle = await store.getIdleConversations(5_000)
    expect(idle.find(c => c.conversationId === 'conv-2')).toBeUndefined()
  })

  it('a conversation that resumes after being processed becomes idle again', async () => {
    // Regression: processed conversations were excluded permanently, so a
    // thread that went quiet, got observed, then resumed never contributed
    // to memory again — exactly the long-running threads memory is for.
    const ctx: EngineContext = { conversationId: 'conv-3', scopeId: 'org-1' }
    const internal = (store as any).messageEmbeddings as Map<string, any>
    const processed = (store as any).processedConversations as Map<string, Date>

    // A message two minutes ago, observed one minute ago.
    await store.saveMessageEmbedding('msg-3a', 'first', [1, 0], ctx)
    internal.get('msg-3a').createdAt = new Date(Date.now() - 120_000)
    await store.markConversationProcessed('conv-3')
    processed.set('conv-3', new Date(Date.now() - 60_000))

    expect(
      (await store.getIdleConversations(5_000)).find(c => c.conversationId === 'conv-3'),
    ).toBeUndefined()

    // The visitor comes back after that observation, then goes quiet again.
    await store.saveMessageEmbedding('msg-3b', 'second', [0, 1], ctx)
    internal.get('msg-3b').createdAt = new Date(Date.now() - 10_000)

    const idleAgain = await store.getIdleConversations(5_000)
    expect(idleAgain.find(c => c.conversationId === 'conv-3')).toBeDefined()
  })

  it('stays excluded when nothing new arrives after processing', async () => {
    const ctx: EngineContext = { conversationId: 'conv-4', scopeId: 'org-1' }
    const internal = (store as any).messageEmbeddings as Map<string, any>
    await store.saveMessageEmbedding('msg-4', 'only message', [1, 0], ctx)
    internal.get('msg-4').createdAt = new Date(Date.now() - 60_000)

    await store.markConversationProcessed('conv-4')
    await store.markConversationProcessed('conv-4') // re-runs stay idempotent

    const idle = await store.getIdleConversations(5_000)
    expect(idle.find(c => c.conversationId === 'conv-4')).toBeUndefined()
  })

  it('searchMessages filters by subScopeId', async () => {
    const ctxA: EngineContext = { conversationId: 'conv-A', scopeId: 'org-1', subScopeId: 'user-A' }
    const ctxB: EngineContext = { conversationId: 'conv-B', scopeId: 'org-1', subScopeId: 'user-B' }
    await store.saveMessageEmbedding('msg-a', 'from A', [1, 0], ctxA)
    await store.saveMessageEmbedding('msg-b', 'from B', [0, 1], ctxB)

    const results = await store.searchMessages([1, 0], 10, ctxA)
    expect(results.every(r => r.conversationId === 'conv-A')).toBe(true)
  })

  // ── Mutations ─────────────────────────────────────────────────────────────

  it('saveMutation and listMutations with status filter', async () => {
    await store.saveMutation({
      id: uuid(),
      scopeId: 'org-1',
      subScopeId: null,
      mutation: { operation: 'add', memory: makeMemory() },
      approver: 'org-admin',
      status: 'pending',
      createdAt: new Date(),
    })
    const pending = await store.listMutations({ scopeId: 'org-1', status: 'pending' })
    expect(pending).toHaveLength(1)
    const approved = await store.listMutations({ scopeId: 'org-1', status: 'approved' })
    expect(approved).toHaveLength(0)
  })

  // ── Search operations ──────────────────────────────────────────────────────

  it('searchMemories returns top-k by dot-product similarity', async () => {
    const mem1 = makeMemory({ embedding: [1, 0, 0] })
    const mem2 = makeMemory({ embedding: [0, 1, 0] })
    const mem3 = makeMemory({ embedding: [0, 0, 1] })
    await store.saveMemory(mem1)
    await store.saveMemory(mem2)
    await store.saveMemory(mem3)

    const results = await store.searchMemories([1, 0, 0], 1, { scopeId: 'org-1' })
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe(mem1.id)
  })

  it('searchObservations filters by subScopeId', async () => {
    const obsA = makeObs({ subScopeId: 'user-A', statementEmbedding: [1, 0] })
    const obsNull = makeObs({ subScopeId: null, statementEmbedding: [0, 1] })
    await store.saveObservation(obsA)
    await store.saveObservation(obsNull)

    const results = await store.searchObservations([1, 0], 10, 'org-1', 'user-A')
    expect(results).toHaveLength(1)
    expect(results[0].subScopeId).toBe('user-A')
  })

  it('searchObservations with no subScopeId filter returns all active', async () => {
    const obsA = makeObs({ subScopeId: 'user-A', statementEmbedding: [1, 0] })
    const obsNull = makeObs({ subScopeId: null, statementEmbedding: [1, 0] })
    await store.saveObservation(obsA)
    await store.saveObservation(obsNull)

    const results = await store.searchObservations([1, 0], 10, 'org-1', undefined)
    expect(results).toHaveLength(2)
  })

  it('listMessagesByConversation returns messages for that conversation only', async () => {
    const ctx1: EngineContext = { conversationId: 'conv-1', scopeId: 'org-1' }
    const ctx2: EngineContext = { conversationId: 'conv-2', scopeId: 'org-1' }
    await store.saveMessageEmbedding('msg-1a', 'hello from conv-1', [1, 0], ctx1)
    await store.saveMessageEmbedding('msg-1b', 'also from conv-1', [0, 1], ctx1)
    await store.saveMessageEmbedding('msg-2a', 'hello from conv-2', [1, 0], ctx2)

    const results = await store.listMessagesByConversation('conv-1')
    expect(results).toHaveLength(2)
    expect(results.every(r => r.conversationId === 'conv-1')).toBe(true)
  })

  it('getMutation returns null for missing id', async () => {
    const result = await store.getMutation('nonexistent-uuid')
    expect(result).toBeNull()
  })

  it('updateMutationStatus changes status', async () => {
    const mutId = uuid()
    await store.saveMutation({
      id: mutId,
      scopeId: 'org-1',
      subScopeId: null,
      mutation: { operation: 'add', memory: makeMemory() },
      approver: 'org-admin',
      status: 'pending',
      createdAt: new Date(),
    })

    await store.updateMutationStatus(mutId, 'approved', new Date())

    const approved = await store.listMutations({ scopeId: 'org-1', status: 'approved' })
    expect(approved).toHaveLength(1)
    expect(approved[0].id).toBe(mutId)
  })
})
