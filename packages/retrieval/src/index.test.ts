import { describe, it, expect } from 'vitest'
import { createRetriever } from './index.ts'
import { DirectRetriever } from './strategies/direct.ts'
import { RagRetriever } from './strategies/rag.ts'
import { BashRetriever } from './strategies/bash.ts'
import { type RetrieverConfig, type RetrievalStrategy } from './types.ts'

const baseConfig: RetrieverConfig = {
  agentId: 'agent-1',
  tenantId: 'tenant-1',
  fileKeys: [],
  sourceUrls: []
}

describe('createRetriever', () => {
  it('returns a DirectRetriever for the "direct" strategy', () => {
    const r = createRetriever('direct', baseConfig)
    expect(r).toBeInstanceOf(DirectRetriever)
  })

  it('returns a RagRetriever for the "rag" strategy', () => {
    const r = createRetriever('rag', baseConfig)
    expect(r).toBeInstanceOf(RagRetriever)
  })

  it('returns a BashRetriever for the "bash" strategy', () => {
    const r = createRetriever('bash', baseConfig)
    expect(r).toBeInstanceOf(BashRetriever)
  })

  it('falls back to DirectRetriever for an unknown strategy', () => {
    // Cast through unknown to exercise the runtime default branch.
    const r = createRetriever(
      'totally-unknown' as unknown as RetrievalStrategy,
      baseConfig
    )
    expect(r).toBeInstanceOf(DirectRetriever)
  })

  it('produces an object implementing the Retriever interface', () => {
    const r = createRetriever('direct', baseConfig)
    expect(typeof r.prepare).toBe('function')
    expect(typeof r.build).toBe('function')
    expect(typeof r.dispose).toBe('function')
  })

  it('does not throw constructing any strategy with a populated config', () => {
    const cfg: RetrieverConfig = {
      agentId: 'a',
      tenantId: 't',
      fileKeys: ['k1', 'k2'],
      sourceUrls: ['https://example.com']
    }
    expect(() => createRetriever('direct', cfg)).not.toThrow()
    expect(() => createRetriever('rag', cfg)).not.toThrow()
    expect(() => createRetriever('bash', cfg)).not.toThrow()
  })
})
