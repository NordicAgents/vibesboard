import { describe, expect, it } from 'vitest'
// Import builtin first so its registerBuiltinTool() side effects populate the
// BUILTIN_TOOL_FACTORIES instance exported from ./base.ts, then drive
// createToolKit directly from that same ./base.ts instance.
import './builtin.ts'
import { BUILTIN_TOOL_FACTORIES, createToolKit } from './base.ts'

const fakeAgent = (tools: unknown[]) =>
  ({ id: 'a1', tenantId: 't1', tools }) as any

const kitFor = (type: string) =>
  createToolKit(fakeAgent([{ type }]), {}, BUILTIN_TOOL_FACTORIES)

describe('builtin registry', () => {
  it('registers web_fetch and file_search factories', () => {
    expect(typeof BUILTIN_TOOL_FACTORIES['builtin:web_fetch']).toBe('function')
    expect(typeof BUILTIN_TOOL_FACTORIES['builtin:file_search']).toBe('function')
  })
})

describe('createToolKit', () => {
  it('builds an empty toolkit for an agent with no tools', () => {
    const kit = createToolKit(fakeAgent([]), {}, BUILTIN_TOOL_FACTORIES)
    expect(kit.functions).toEqual([])
    expect(Object.keys(kit.executors)).toEqual([])
  })

  it('ignores unknown tool types', () => {
    const kit = kitFor('totally-unknown')
    expect(kit.functions.length).toBe(0)
  })

  it('builds a web_fetch tool with the expected schema', () => {
    const kit = kitFor('builtin:web_fetch')
    expect(kit.functions.length).toBe(1)
    const fn = kit.functions[0]
    expect(fn.name).toBe('web_fetch')
    expect(fn.parameters?.required).toEqual(['url'])
    expect(typeof kit.executors[fn.name]).toBe('function')
  })

  it('web_fetch executor returns a message when no URL is supplied', async () => {
    const kit = kitFor('builtin:web_fetch')
    const out = await kit.executors[kit.functions[0].name]({}, {})
    expect(out).toBe('No URL provided.')
  })

  it('builds a file_search tool with a query parameter', () => {
    const kit = kitFor('builtin:file_search')
    expect(kit.functions.length).toBe(1)
    expect(kit.functions[0].name).toBe('file_search')
    expect(kit.functions[0].parameters?.required).toEqual(['query'])
  })

  it('file_search executor prompts when query is empty', async () => {
    const kit = kitFor('builtin:file_search')
    const out = await kit.executors[kit.functions[0].name]({ query: '   ' }, {})
    expect(out).toMatch(/provide a search query/)
  })

  it('maps each registered function to an executor of the same name', () => {
    const kit = createToolKit(
      fakeAgent([{ type: 'builtin:web_fetch' }, { type: 'builtin:file_search' }]),
      {},
      BUILTIN_TOOL_FACTORIES,
    )
    expect(kit.functions.length).toBe(2)
    for (const fn of kit.functions) {
      expect(typeof kit.executors[fn.name]).toBe('function')
    }
  })
})
