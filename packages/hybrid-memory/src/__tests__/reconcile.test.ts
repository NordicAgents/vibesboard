import { randomUUID as uuid } from 'node:crypto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { InMemoryHybridStore } from '../stores/in-memory.ts'
import { runReconciliation, applyMutation } from '../pipeline/reconcile.ts'
import type { Observation, HybridMemory, MemoryMutation } from '../types.ts'

function mockLlm(response: object) {
  return { complete: vi.fn().mockResolvedValue(JSON.stringify(response)) }
}

function mockEmbedder() {
  return { embed: vi.fn().mockResolvedValue([0, 0, 1]), embedBatch: vi.fn().mockImplementation(async (texts: string[]) => texts.map(() => [0, 0, 1])) }
}

function makeObs(overrides: Partial<Observation> = {}): Observation {
  return {
    id: uuid(),
    conversationId: uuid(),
    scopeId: 'agent-1',
    subScopeId: null,
    statement: 'user prefers brief answers',
    evidence: 'user said keep it short',
    status: 'new',
    statementEmbedding: [1, 0, 0],
    evidenceEmbedding: [0, 1, 0],
    createdAt: new Date(),
    ...overrides,
  }
}

function makeMemory(overrides: Partial<HybridMemory> = {}): HybridMemory {
  return {
    id: uuid(),
    scopeId: 'agent-1',
    subScopeId: null,
    scope: 'org',
    key: '/prefs/style',
    description: 'Test memory',
    content: 'User prefers concise responses',
    category: 'preference',
    presenceClass: 'pattern',
    triggerPatterns: [],
    importance: 0.7,
    surprise: 0,
    accessCount: 0,
    lastAccessed: new Date(),
    version: 1,
    createdAt: new Date(),
    ...overrides,
  }
}

describe('runReconciliation', () => {
  let store: InMemoryHybridStore

  beforeEach(() => {
    store = new InMemoryHybridStore()
  })

  it('JSON parse failure defers the observation', async () => {
    const llm = { complete: vi.fn().mockResolvedValue('not json') }
    const embedder = mockEmbedder()
    const obs = makeObs()
    await store.saveObservation(obs)

    const result = await runReconciliation({
      llm,
      store,
      embedder,
      observationNeighbors: 3,
      messageNeighbors: 5,
      maxDefers: 3,
      autoApprove: false,
    })

    expect(result.deferred).toBe(1)
    const pending = await store.getPendingObservations('agent-1')
    expect(pending).toHaveLength(1)
    expect(pending[0].status).toBe('deferred')
  })

  it('LLM decision "defer" defers the observation', async () => {
    const llm = mockLlm({ decision: 'defer', reasoning: 'need more data' })
    const embedder = mockEmbedder()
    const obs = makeObs()
    await store.saveObservation(obs)

    const result = await runReconciliation({
      llm,
      store,
      embedder,
      observationNeighbors: 3,
      messageNeighbors: 5,
      maxDefers: 3,
      autoApprove: false,
    })

    expect(result.deferred).toBe(1)
    const pending = await store.getPendingObservations('agent-1')
    expect(pending).toHaveLength(1)
    expect(pending[0].status).toBe('deferred')
  })

  it('defer past maxDefers discards the observation instead of re-queuing it', async () => {
    const llm = mockLlm({ decision: 'defer', reasoning: 'need more data' })
    const embedder = mockEmbedder()
    const obs = makeObs({ status: 'deferred', deferCount: 3 })
    await store.saveObservation(obs)

    const result = await runReconciliation({
      llm,
      store,
      embedder,
      observationNeighbors: 3,
      messageNeighbors: 5,
      maxDefers: 3,
      autoApprove: false,
    })

    expect(result.discarded).toBe(1)
    expect(result.deferred).toBe(0)
    const pending = await store.getPendingObservations('agent-1')
    expect(pending).toHaveLength(0)
  })

  it('deferring increments deferCount so repeated defers eventually discard', async () => {
    const llm = mockLlm({ decision: 'defer', reasoning: 'need more data' })
    const embedder = mockEmbedder()
    const obs = makeObs()
    await store.saveObservation(obs)

    const opts = {
      llm,
      store,
      embedder,
      observationNeighbors: 3,
      messageNeighbors: 5,
      maxDefers: 2,
      autoApprove: false,
    }

    // Runs 1 and 2 defer (deferCount 0→1→2), run 3 hits the cap and discards
    expect((await runReconciliation(opts)).deferred).toBe(1)
    expect((await runReconciliation(opts)).deferred).toBe(1)
    const third = await runReconciliation(opts)
    expect(third.discarded).toBe(1)
    expect(await store.getPendingObservations('agent-1')).toHaveLength(0)
  })

  it('LLM decision "discard" discards the observation', async () => {
    const llm = mockLlm({ decision: 'discard', reasoning: 'one-off' })
    const embedder = mockEmbedder()
    const obs = makeObs()
    await store.saveObservation(obs)

    const result = await runReconciliation({
      llm,
      store,
      embedder,
      observationNeighbors: 3,
      messageNeighbors: 5,
      maxDefers: 3,
      autoApprove: false,
    })

    expect(result.discarded).toBe(1)
    // 'discarded' is not 'new' or 'deferred', so it drops out of pending
    const pending = await store.getPendingObservations('agent-1')
    expect(pending).toHaveLength(0)
  })

  it('"mutate" with add operation creates a pending mutation', async () => {
    const llm = mockLlm({
      decision: 'mutate',
      reasoning: 'new preference detected',
      mutations: [
        {
          operation: 'add',
          key: '/prefs/style',
          content: 'brief',
          presenceClass: 'pattern',
          triggerPatterns: [],
        },
      ],
    })
    const embedder = mockEmbedder()
    const obs = makeObs()
    await store.saveObservation(obs)

    const result = await runReconciliation({
      llm,
      store,
      embedder,
      observationNeighbors: 3,
      messageNeighbors: 5,
      maxDefers: 3,
      autoApprove: false,
    })

    expect(result.mutated).toBe(1)
    // Observation should now be 'consolidated' — no longer pending
    const pending = await store.getPendingObservations('agent-1')
    expect(pending).toHaveLength(0)
    // Exactly one pending mutation with operation 'add'
    const mutations = await store.listMutations({ scopeId: 'agent-1' })
    expect(mutations).toHaveLength(1)
    expect(mutations[0].mutation.operation).toBe('add')
    expect(mutations[0].status).toBe('pending')
  })

  it('"mutate" with modify but no memoryId — mutation is silently skipped', async () => {
    const llm = mockLlm({
      decision: 'mutate',
      reasoning: 'trying to modify without a target',
      mutations: [{ operation: 'modify' }],
    })
    const embedder = mockEmbedder()
    const obs = makeObs()
    await store.saveObservation(obs)

    const result = await runReconciliation({
      llm,
      store,
      embedder,
      observationNeighbors: 3,
      messageNeighbors: 5,
      maxDefers: 3,
      autoApprove: false,
    })

    expect(result.mutated).toBe(1)
    const mutations = await store.listMutations({ scopeId: 'agent-1' })
    expect(mutations).toHaveLength(0)
    // Observation is consolidated even though no mutation was created
    const pending = await store.getPendingObservations('agent-1')
    expect(pending).toHaveLength(0)
  })

  it('unknown operation is skipped — no mutation saved, observation consolidated', async () => {
    const llm = mockLlm({
      decision: 'mutate',
      reasoning: 'archiving old pref',
      mutations: [{ operation: 'archive' }],
    })
    const embedder = mockEmbedder()
    const obs = makeObs()
    await store.saveObservation(obs)

    const result = await runReconciliation({
      llm,
      store,
      embedder,
      observationNeighbors: 3,
      messageNeighbors: 5,
      maxDefers: 3,
      autoApprove: false,
    })

    expect(result.mutated).toBe(1)
    const mutations = await store.listMutations({ scopeId: 'agent-1' })
    expect(mutations).toHaveLength(0)
  })

  it('autoApprove=true — apply succeeds, mutation status set to "approved"', async () => {
    const llm = mockLlm({
      decision: 'mutate',
      reasoning: 'new preference',
      mutations: [
        {
          operation: 'add',
          key: '/prefs/style',
          content: 'brief',
          presenceClass: 'pattern',
          triggerPatterns: [],
        },
      ],
    })
    const embedder = mockEmbedder()
    const obs = makeObs()
    await store.saveObservation(obs)

    await runReconciliation({
      llm,
      store,
      embedder,
      observationNeighbors: 3,
      messageNeighbors: 5,
      maxDefers: 3,
      autoApprove: true,
    })

    const approved = await store.listMutations({ scopeId: 'agent-1', status: 'approved' })
    expect(approved).toHaveLength(1)
    // The add mutation should have persisted a real memory into the store
    const memories = await store.listMemories({ scopeId: 'agent-1' })
    expect(memories).toHaveLength(1)
  })

  it('autoApprove=true — apply throws, mutation status set to "rejected"', async () => {
    const nonExistentId = uuid()
    const llm = mockLlm({
      decision: 'mutate',
      reasoning: 'update existing preference',
      mutations: [
        {
          operation: 'modify',
          memoryId: nonExistentId,
          content: 'updated content',
        },
      ],
    })
    const embedder = mockEmbedder()
    const obs = makeObs()
    await store.saveObservation(obs)

    await runReconciliation({
      llm,
      store,
      embedder,
      observationNeighbors: 3,
      messageNeighbors: 5,
      maxDefers: 3,
      autoApprove: true,
    })

    const rejected = await store.listMutations({ scopeId: 'agent-1', status: 'rejected' })
    expect(rejected).toHaveLength(1)
    // Observation processing succeeded — it should be 'consolidated', not pending
    const pending = await store.getPendingObservations('agent-1')
    expect(pending).toHaveLength(0)
  })
})

describe('applyMutation', () => {
  it('scope check — modify blocks cross-scope write', async () => {
    const store = new InMemoryHybridStore()
    const embedder = mockEmbedder()
    const memory = makeMemory({ scopeId: 'agent-1' })
    await store.saveMemory(memory)

    const mutation: MemoryMutation = {
      operation: 'modify',
      memoryId: memory.id,
      patch: { content: 'updated content' },
    }

    await expect(
      applyMutation(mutation, store, embedder, 'agent-2', null),
    ).rejects.toThrow('not in scope')
  })

  it('scope check — delete is idempotent when memory already gone', async () => {
    const store = new InMemoryHybridStore()
    const embedder = mockEmbedder()
    const nonExistentId = uuid()

    const mutation: MemoryMutation = {
      operation: 'delete',
      memoryId: nonExistentId,
    }

    await expect(
      applyMutation(mutation, store, embedder, 'agent-1', null),
    ).resolves.toBeUndefined()
  })
})
