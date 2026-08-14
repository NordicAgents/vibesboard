import { describe, it, expect, beforeEach, vi } from 'vitest'

// The real @vibesboard/ai data layer pulls in S3/OpenAI adapters and the RAG
// pipeline, so we replace both modules and drive returns per test.
const searchAgentFileChunks = vi.fn()
const fetchUrlContent = vi.fn()

vi.mock('@vibesboard/ai/file-search', () => ({
  searchAgentFileChunks: (...args: unknown[]) => searchAgentFileChunks(...args)
}))
vi.mock('@vibesboard/ai/fetch-url-content', () => ({
  fetchUrlContent: (...args: unknown[]) => fetchUrlContent(...args)
}))

import { RagRetriever } from './rag.ts'
import { type RetrieverConfig } from '../types.ts'

function cfg(overrides: Partial<RetrieverConfig> = {}): RetrieverConfig {
  return {
    agentId: 'agent-1',
    tenantId: 'tenant-1',
    fileKeys: [],
    sourceUrls: [],
    ...overrides
  }
}

function urlOk(url: string, title: string | null, textContent: string) {
  return { url, title, textContent, error: undefined }
}

beforeEach(() => {
  searchAgentFileChunks.mockReset()
  fetchUrlContent.mockReset()
})

describe('RagRetriever.prepare/dispose', () => {
  it('prepare and dispose are no-ops that resolve', async () => {
    const r = new RagRetriever(cfg())
    await expect(r.prepare()).resolves.toBeUndefined()
    await expect(r.dispose()).resolves.toBeUndefined()
  })
})

describe('RagRetriever.build — tool exposure', () => {
  it('does NOT expose file_search when there are no file keys', async () => {
    const r = new RagRetriever(cfg({ fileKeys: [] }))
    const result = await r.build()
    expect(result.tools).toEqual([])
    expect(result.contextText).toBe('')
    expect(result.sources).toEqual([])
    expect(result.hasOverflow).toBe(false)
    expect(searchAgentFileChunks).not.toHaveBeenCalled()
  })

  it('exposes a single file_search tool when files exist', async () => {
    const r = new RagRetriever(cfg({ fileKeys: ['k1'] }))
    const result = await r.build()
    expect(result.tools).toHaveLength(1)
    const tool = result.tools[0]
    expect(tool.function.name).toBe('file_search')
    expect(tool.function.parameters.required).toEqual(['query'])
    expect(tool.function.parameters.properties).toHaveProperty('query')
    expect(tool.function.parameters.properties).toHaveProperty('limit')
  })

  it('does NOT expose file_search when the File search toggle is off', async () => {
    // Regression: this retriever injected file_search purely on "agent has
    // files", and it wins the name-collision merge in buildAgentContext — so
    // the Knowledge tab switch had no effect at all under the RAG strategy.
    const r = new RagRetriever(
      cfg({ fileKeys: ['k1'], fileSearchEnabled: false })
    )
    const result = await r.build()
    expect(result.tools).toEqual([])
    expect(searchAgentFileChunks).not.toHaveBeenCalled()
  })

  it('treats an omitted fileSearchEnabled as enabled', async () => {
    const r = new RagRetriever(cfg({ fileKeys: ['k1'] }))
    const result = await r.build()
    expect(result.tools).toHaveLength(1)
  })

  it('still returns source-URL context when the toggle is off', async () => {
    // Source URLs are context, not a file tool, so disabling file search
    // must not silently drop them.
    fetchUrlContent.mockResolvedValue(
      urlOk('https://example.com', 'Example', 'url body text')
    )
    const r = new RagRetriever(
      cfg({
        fileKeys: ['k1'],
        sourceUrls: ['https://example.com'],
        fileSearchEnabled: false
      })
    )
    const result = await r.build()
    expect(result.tools).toEqual([])
    expect(result.contextText).toContain('url body text')
    expect(result.sources).toContain('https://example.com')
  })

  it('never pre-loads file content into context even when files exist', async () => {
    const r = new RagRetriever(cfg({ fileKeys: ['k1', 'k2'] }))
    const result = await r.build()
    expect(result.contextText).toBe('')
    expect(result.sources).toEqual([])
  })
})

describe('RagRetriever.build — source URLs', () => {
  it('inlines successful URL content and records the source', async () => {
    fetchUrlContent.mockResolvedValue(urlOk('https://x.com/a', 'Title', 'body'))
    const r = new RagRetriever(cfg({ sourceUrls: ['https://x.com/a'] }))
    const result = await r.build()
    expect(result.contextText).toBe('[Source: Title]\nURL: https://x.com/a\nbody')
    expect(result.sources).toEqual(['https://x.com/a'])
  })

  it('caps fetched URLs at 5', async () => {
    fetchUrlContent.mockImplementation(async (url: string) => urlOk(url, null, 'c'))
    const sourceUrls = Array.from({ length: 7 }, (_, i) => `https://x.com/${i}`)
    const r = new RagRetriever(cfg({ sourceUrls }))
    await r.build()
    expect(fetchUrlContent).toHaveBeenCalledTimes(5)
  })

  it('skips errored URL results', async () => {
    fetchUrlContent.mockResolvedValue({
      url: 'https://x.com/e',
      title: undefined,
      textContent: 'ignored',
      error: 'Blocked URL host'
    })
    const r = new RagRetriever(cfg({ sourceUrls: ['https://x.com/e'] }))
    const result = await r.build()
    expect(result.contextText).toBe('')
    expect(result.sources).toEqual([])
  })

  it('still returns the file_search tool alongside URL context', async () => {
    fetchUrlContent.mockResolvedValue(urlOk('https://x.com/a', 'T', 'body'))
    const r = new RagRetriever(
      cfg({ fileKeys: ['k1'], sourceUrls: ['https://x.com/a'] })
    )
    const result = await r.build()
    expect(result.tools).toHaveLength(1)
    expect(result.contextText).toContain('body')
    expect(result.sources).toEqual(['https://x.com/a'])
  })
})

describe('RagRetriever file_search tool — execute logic', () => {
  async function getTool() {
    const r = new RagRetriever(
      cfg({ fileKeys: ['k1'], agentId: 'A', tenantId: 'T' })
    )
    const result = await r.build()
    return result.tools[0]
  }

  it('rejects a missing query', async () => {
    const tool = await getTool()
    const out = await tool.execute({}, {})
    expect(out).toBe('Please provide a search query to look up within the files.')
    expect(searchAgentFileChunks).not.toHaveBeenCalled()
  })

  it('rejects a whitespace-only query', async () => {
    const tool = await getTool()
    const out = await tool.execute({ query: '   ' }, {})
    expect(out).toBe('Please provide a search query to look up within the files.')
    expect(searchAgentFileChunks).not.toHaveBeenCalled()
  })

  it('passes tenantId/agentId/query/limit through to the RAG pipeline', async () => {
    searchAgentFileChunks.mockResolvedValue({
      matches: [{ fileName: 'f.txt', snippet: 'snip' }],
      error: undefined
    })
    const tool = await getTool()
    await tool.execute({ query: 'invoices', limit: 3 }, {})
    expect(searchAgentFileChunks).toHaveBeenCalledWith({
      tenantId: 'T',
      agentId: 'A',
      query: 'invoices',
      limit: 3
    })
  })

  it('defaults limit to 8 when not provided', async () => {
    searchAgentFileChunks.mockResolvedValue({ matches: [], error: undefined })
    const tool = await getTool()
    await tool.execute({ query: 'x' }, {})
    expect(searchAgentFileChunks).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 8 })
    )
  })

  it('defaults limit to 8 when limit is non-finite (string)', async () => {
    searchAgentFileChunks.mockResolvedValue({ matches: [], error: undefined })
    const tool = await getTool()
    await tool.execute({ query: 'x', limit: 'not-a-number' }, {})
    expect(searchAgentFileChunks).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 8 })
    )
  })

  it('honors a finite numeric limit (including 0)', async () => {
    searchAgentFileChunks.mockResolvedValue({ matches: [], error: undefined })
    const tool = await getTool()
    await tool.execute({ query: 'x', limit: 0 }, {})
    expect(searchAgentFileChunks).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 0 })
    )
  })

  it('trims surrounding whitespace from the query before searching', async () => {
    searchAgentFileChunks.mockResolvedValue({ matches: [], error: undefined })
    const tool = await getTool()
    await tool.execute({ query: '  hello  ' }, {})
    expect(searchAgentFileChunks).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'hello' })
    )
  })

  it('formats multiple matches with File/Snippet blocks joined by ---', async () => {
    searchAgentFileChunks.mockResolvedValue({
      matches: [
        { fileName: 'a.txt', snippet: 'alpha' },
        { fileName: 'b.txt', snippet: 'beta' }
      ],
      error: undefined
    })
    const tool = await getTool()
    const out = await tool.execute({ query: 'q' }, {})
    expect(out).toBe(
      'Matches for "q":\nFile: a.txt\nSnippet:\nalpha\n---\nFile: b.txt\nSnippet:\nbeta'
    )
  })

  it('returns a "no results" message when matches is empty and no error', async () => {
    searchAgentFileChunks.mockResolvedValue({ matches: [], error: undefined })
    const tool = await getTool()
    const out = await tool.execute({ query: 'nope' }, {})
    expect(out).toBe('No results found for "nope".')
  })

  it('returns the error message when there is an error and no matches', async () => {
    searchAgentFileChunks.mockResolvedValue({
      matches: [],
      error: 'embedding service down'
    })
    const tool = await getTool()
    const out = await tool.execute({ query: 'q' }, {})
    expect(out).toBe('File search error: embedding service down')
  })

  it('prefers returning matches over surfacing an error when both present', async () => {
    searchAgentFileChunks.mockResolvedValue({
      matches: [{ fileName: 'f.txt', snippet: 'partial' }],
      error: 'degraded'
    })
    const tool = await getTool()
    const out = await tool.execute({ query: 'q' }, {})
    expect(out).toBe('Matches for "q":\nFile: f.txt\nSnippet:\npartial')
  })
})

describe('RagRetriever tenant isolation', () => {
  it('uses the retriever-bound tenantId/agentId, not values from tool args', async () => {
    searchAgentFileChunks.mockResolvedValue({ matches: [], error: undefined })
    const r = new RagRetriever(
      cfg({ fileKeys: ['k'], agentId: 'real-agent', tenantId: 'real-tenant' })
    )
    const result = await r.build()
    const tool = result.tools[0]
    // A misbehaving model could try to inject foreign ids via the tool args;
    // the retriever must ignore them and use its bound tenant/agent.
    await tool.execute(
      { query: 'leak', tenantId: 'attacker-tenant', agentId: 'attacker-agent' },
      {}
    )
    expect(searchAgentFileChunks).toHaveBeenCalledWith({
      tenantId: 'real-tenant',
      agentId: 'real-agent',
      query: 'leak',
      limit: 8
    })
  })
})
