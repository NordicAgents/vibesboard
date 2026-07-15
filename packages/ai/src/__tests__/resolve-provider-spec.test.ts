import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CredStore } from '../cred-store/types.ts'

// vi.mock is hoisted by vitest before imports, so getMigrateDb is mocked
// before tenant-llm-config.ts is evaluated.
vi.mock('@vibesboard/adapter-postgres/client', () => ({
  getMigrateDb: vi.fn(),
}))

import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { resolveProviderSpec } from '../tenant-llm-config.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a chainable drizzle-like query builder that resolves with `rows`. */
function makeChain(rows: unknown[]) {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    // Thenable: satisfies both `await chain` and explicit `chain.then(cb)`.
    then: (resolve?: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve as any, reject),
  }
  return chain
}

const mockStore: CredStore = {
  seal: vi.fn(async (p: string) => `sealed:${p}`),
  unseal: vi.fn(async () => 'decrypted-key'),
  revoke: vi.fn(async () => {}),
}

const TENANT_ID = 'tenant-abc-123'
const CONFIG_ID = 'config-xyz-456'

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONFIG_ID,
    tenantId: TENANT_ID,
    label: 'Test Config',
    kind: 'openai' as 'openai' | 'anthropic' | 'openai_compatible' | 'google',
    modelId: 'gpt-4',
    baseUrl: null as string | null,
    apiKeyEncrypted: 'encrypted-token' as string | null,
    isEnabled: true,
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: empty result set (no config found)
  vi.mocked(getMigrateDb).mockReturnValue(makeChain([]) as any)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveProviderSpec', () => {
  it('returns null when no config row exists', async () => {
    vi.mocked(getMigrateDb).mockReturnValue(makeChain([]) as any)

    const result = await resolveProviderSpec(TENANT_ID, CONFIG_ID, mockStore)

    expect(result).toBeNull()
  })

  it('returns null when apiKeyEncrypted is missing on the row', async () => {
    vi.mocked(getMigrateDb).mockReturnValue(
      makeChain([makeRow({ apiKeyEncrypted: null })]) as any,
    )

    const result = await resolveProviderSpec(TENANT_ID, CONFIG_ID, mockStore)

    expect(result).toBeNull()
  })

  it('returns an openai spec for kind=openai without baseUrl', async () => {
    vi.mocked(getMigrateDb).mockReturnValue(
      makeChain([makeRow({ kind: 'openai', baseUrl: null })]) as any,
    )

    const result = await resolveProviderSpec(TENANT_ID, CONFIG_ID, mockStore)

    expect(result).not.toBeNull()
    expect(result?.kind).toBe('openai')
    expect(result?.modelId).toBe('gpt-4')
    expect(result?.apiKey).toBe('decrypted-key')
    expect((result as any).baseUrl).toBeUndefined()
  })

  it('returns an openai spec with baseUrl when provided', async () => {
    vi.mocked(getMigrateDb).mockReturnValue(
      makeChain([makeRow({ kind: 'openai', baseUrl: 'https://custom.openai.com' })]) as any,
    )

    const result = await resolveProviderSpec(TENANT_ID, CONFIG_ID, mockStore)

    expect(result?.kind).toBe('openai')
    expect((result as any).baseUrl).toBe('https://custom.openai.com')
  })

  it('returns an anthropic spec for kind=anthropic', async () => {
    vi.mocked(getMigrateDb).mockReturnValue(
      makeChain([makeRow({ kind: 'anthropic' })]) as any,
    )

    const result = await resolveProviderSpec(TENANT_ID, CONFIG_ID, mockStore)

    expect(result?.kind).toBe('anthropic')
    expect(result?.apiKey).toBe('decrypted-key')
    // anthropic spec has no baseUrl field
    expect((result as any).baseUrl).toBeUndefined()
  })

  it('returns an openai_compatible spec with baseUrl', async () => {
    vi.mocked(getMigrateDb).mockReturnValue(
      makeChain([
        makeRow({ kind: 'openai_compatible', baseUrl: 'http://ollama:11434/v1' }),
      ]) as any,
    )

    const result = await resolveProviderSpec(TENANT_ID, CONFIG_ID, mockStore)

    expect(result?.kind).toBe('openai_compatible')
    expect(result?.apiKey).toBe('decrypted-key')
    expect((result as any).baseUrl).toBe('http://ollama:11434/v1')
  })

  it('returns null when kind=openai_compatible has no baseUrl', async () => {
    vi.mocked(getMigrateDb).mockReturnValue(
      makeChain([makeRow({ kind: 'openai_compatible', baseUrl: null })]) as any,
    )

    const result = await resolveProviderSpec(TENANT_ID, CONFIG_ID, mockStore)

    // The function logs an error and returns null for this misconfiguration.
    expect(result).toBeNull()
  })

  it('returns a google spec for kind=google', async () => {
    vi.mocked(getMigrateDb).mockReturnValue(
      makeChain([makeRow({ kind: 'google', modelId: 'gemini-pro' })]) as any,
    )

    const result = await resolveProviderSpec(TENANT_ID, CONFIG_ID, mockStore)

    expect(result?.kind).toBe('google')
    expect(result?.modelId).toBe('gemini-pro')
    expect(result?.apiKey).toBe('decrypted-key')
  })
})
