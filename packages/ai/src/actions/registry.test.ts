import { describe, expect, it } from 'vitest'
import { injectActionTools } from './registry.ts'

// injectActionTools mutates the toolkit in place. It returns early when the
// agent has no tenantId — that path does NOT touch the database, so it is the
// deterministic, isolation-safe contract to assert here. (The feature-flag
// branch routes through getMigrateDb() against the shared public schema, which
// has no DB-injection seam and is intentionally out of scope for a per-test
// isolated DB.)

const emptyToolkit = () => ({
  functions: [] as any[],
  executors: {} as Record<string, any>,
})

describe('injectActionTools', () => {
  it('adds no tools when the agent has no tenantId', async () => {
    const toolkit = emptyToolkit()
    await injectActionTools({ id: 'a1', actions: [] } as any, toolkit)
    expect(toolkit.functions.length).toBe(0)
    expect(Object.keys(toolkit.executors).length).toBe(0)
  })

  it('does not mutate a pre-populated toolkit when tenantId is absent', async () => {
    const toolkit = {
      functions: [{ name: 'pre_existing' }] as any[],
      executors: { pre_existing: async () => 'ok' } as Record<string, any>,
    }
    await injectActionTools({ id: 'a1' } as any, toolkit)
    // Early return leaves the toolkit untouched.
    expect(toolkit.functions.map((f) => f.name)).toEqual(['pre_existing'])
    expect(Object.keys(toolkit.executors)).toEqual(['pre_existing'])
  })

  it('mutates in place rather than returning a toolkit', async () => {
    const toolkit = emptyToolkit()
    const result = await injectActionTools({ id: 'a1' } as any, toolkit)
    expect(result).toBeUndefined()
  })
})
