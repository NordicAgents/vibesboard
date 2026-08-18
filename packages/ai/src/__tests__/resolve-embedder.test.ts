import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CredStore } from '../cred-store/types.ts'

// vi.mock is hoisted by vitest before imports, so both modules are mocked
// before tenant-llm-config.ts is evaluated.
vi.mock('@vibesboard/adapter-postgres/client', () => ({
  getMigrateDb: vi.fn(),
}))

// Partial mock: only the network call is stubbed, so the module's real
// constants (PLATFORM_EMBEDDING_MODEL, dimensions, ...) keep their values.
vi.mock('@vibesboard/adapter-openai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@vibesboard/adapter-openai')>()),
  createEmbedding: vi.fn(async () => ({ data: [{ index: 0, embedding: [0.1, 0.2] }] })),
}))

import { getTableName } from 'drizzle-orm'
import { createEmbedding } from '@vibesboard/adapter-openai'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { tenantLlmConfigs, tenants } from '@vibesboard/adapter-postgres/schema'
import { resolveEmbedder } from '../tenant-llm-config.ts'

const TABLE_CONFIGS = getTableName(tenantLlmConfigs)
const TABLE_TENANTS = getTableName(tenants)

const TENANT_ID = 'tenant-abc-123'

const mockStore: CredStore = {
  seal: vi.fn(async (p: string) => `sealed:${p}`),
  unseal: vi.fn(async () => 'decrypted-key'),
  revoke: vi.fn(async () => {}),
}

/**
 * Chainable drizzle-like builder that answers by *table*, not by call order.
 * resolveEmbedder fires resolveProviderSpec and the tenants lookup inside a
 * Promise.all, and resolveProviderSpec itself reads the task-assignment table
 * before the config table — so which query runs first is an implementation
 * detail this test should not encode.
 */
function makeDb(rowsFor: (tableName: string) => unknown[]) {
  const db: any = {
    select: () => {
      let rows: unknown[] = []
      const chain: any = {
        from: (table: unknown) => {
          rows = rowsFor(getTableName(table as never))
          return chain
        },
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        then: (resolve?: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(rows).then(resolve as any, reject),
      }
      return chain
    },
  }
  return db
}

function makeConfigRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'config-1',
    tenantId: TENANT_ID,
    label: 'Test',
    kind: 'nvidia',
    modelId: 'nvidia/nemotron-3-embed-1b',
    baseUrl: null,
    apiKeyEncrypted: 'encrypted-token',
    isEnabled: true,
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

/**
 * resolveEmbedder reads three tables: the task assignments (left empty so the
 * tenant default is used), the config row itself, and tenants for the
 * private-host opt-in.
 */
function primeDb(configRow: Record<string, unknown> | null, allowPrivateHosts = false) {
  vi.mocked(getMigrateDb).mockReturnValue(
    makeDb((table) => {
      if (table === TABLE_CONFIGS) return configRow ? [configRow] : []
      if (table === TABLE_TENANTS) return [{ llmAllowPrivateHosts: allowPrivateHosts }]
      return []
    }) as any,
  )
}

/** The params createEmbedding was last called with. */
function lastCall() {
  return vi.mocked(createEmbedding).mock.calls.at(-1)?.[0] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createEmbedding).mockResolvedValue({
    data: [{ index: 0, embedding: [0.1, 0.2] }],
  } as any)
})

describe('resolveEmbedder — NVIDIA input_type', () => {
  // NIM embedding models are asymmetric: a passage and a query for that passage
  // are embedded differently. Sending 'passage' for a query still returns a
  // vector, so the failure is silent and only shows up as degraded recall —
  // which is exactly why it needs a test rather than a comment.
  it("defaults to 'passage' so indexing is unchanged", async () => {
    primeDb(makeConfigRow())

    const embed = await resolveEmbedder(TENANT_ID, mockStore)
    await embed(['a document chunk'])

    expect(lastCall().inputType).toBe('passage')
  })

  it("sends 'query' when the caller is embedding a search query", async () => {
    primeDb(makeConfigRow())

    const embed = await resolveEmbedder(TENANT_ID, mockStore, 'query')
    await embed(['a search query'])

    expect(lastCall().inputType).toBe('query')
  })

  it('omits input_type for third-party models on the NVIDIA catalog', async () => {
    // baai/ and snowflake/ models are served by the same catalog but reject the
    // NIM-only param, so it must not be sent for them regardless of input type.
    primeDb(makeConfigRow({ modelId: 'baai/bge-m3' }))

    const embed = await resolveEmbedder(TENANT_ID, mockStore, 'query')
    await embed(['a search query'])

    expect(lastCall()).not.toHaveProperty('inputType')
  })

  it('defaults the base URL to the NVIDIA catalog endpoint', async () => {
    primeDb(makeConfigRow())

    const embed = await resolveEmbedder(TENANT_ID, mockStore)
    await embed(['x'])

    expect(lastCall().baseUrl).toBe('https://integrate.api.nvidia.com/v1')
    // Uses the tenant's own model rather than falling back to the platform key.
    expect(lastCall().model).toBe('nvidia/nemotron-3-embed-1b')
    expect(lastCall().apiKey).toBe('decrypted-key')
  })

  it('honors a self-hosted NIM base URL and the private-host opt-in', async () => {
    primeDb(makeConfigRow({ baseUrl: 'http://10.0.0.5:8000/v1' }), true)

    const embed = await resolveEmbedder(TENANT_ID, mockStore)
    await embed(['x'])

    expect(lastCall().baseUrl).toBe('http://10.0.0.5:8000/v1')
    expect(lastCall().allowPrivateHost).toBe(true)
  })

  it('does not set allowPrivateHost when the tenant has not opted in', async () => {
    primeDb(makeConfigRow(), false)

    const embed = await resolveEmbedder(TENANT_ID, mockStore)
    await embed(['x'])

    expect(lastCall()).not.toHaveProperty('allowPrivateHost')
  })

  it('returns embeddings ordered by the index the API reports', async () => {
    // The catalog may return results out of order; callers rely on input order.
    primeDb(makeConfigRow())
    vi.mocked(createEmbedding).mockResolvedValue({
      data: [
        { index: 1, embedding: [2] },
        { index: 0, embedding: [1] },
      ],
    } as any)

    const embed = await resolveEmbedder(TENANT_ID, mockStore)

    expect(await embed(['first', 'second'])).toEqual([[1], [2]])
  })
})

describe('resolveEmbedder — openai_compatible input_type', () => {
  it("passes the caller's input type through for NIM models", async () => {
    // openai_compatible requires a baseUrl — rowToProviderSpec drops the row without one.
    primeDb(makeConfigRow({
      kind: 'openai_compatible',
      modelId: 'nvidia/nv-embedqa-e5-v5',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    }))

    const embed = await resolveEmbedder(TENANT_ID, mockStore, 'query')
    await embed(['a search query'])

    expect(lastCall().inputType).toBe('query')
  })

  it('omits input_type for non-NIM models', async () => {
    primeDb(makeConfigRow({
      kind: 'openai_compatible',
      modelId: 'nomic-embed-text',
      baseUrl: 'http://ollama.local:11434/v1',
    }))

    const embed = await resolveEmbedder(TENANT_ID, mockStore, 'query')
    await embed(['a search query'])

    expect(lastCall()).not.toHaveProperty('inputType')
  })
})
