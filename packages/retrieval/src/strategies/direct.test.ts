import { describe, it, expect, beforeEach, vi } from 'vitest'

// --- Mocks for the @vibesboard/ai data layer ---------------------------------
// The real `@vibesboard/ai/file-search` and `/fetch-url-content` modules pull in
// S3 + OpenAI adapters and network I/O. We replace them so we can drive the
// pure budgeting / sorting / overflow logic of DirectRetriever deterministically
// and without touching the network.
const readFullFileContent = vi.fn()
const fetchUrlContent = vi.fn()

vi.mock('@vibesboard/ai/file-search', () => ({
  readFullFileContent: (...args: unknown[]) => readFullFileContent(...args)
}))
vi.mock('@vibesboard/ai/fetch-url-content', () => ({
  fetchUrlContent: (...args: unknown[]) => fetchUrlContent(...args)
}))

import { DirectRetriever } from './direct.ts'
import { type RetrieverConfig } from '../types.ts'

const MAX_CONTEXT_CHARS = 30_000
const FILE_BUDGET = Math.floor(MAX_CONTEXT_CHARS * 0.6) // 18_000

function cfg(overrides: Partial<RetrieverConfig> = {}): RetrieverConfig {
  return {
    agentId: 'agent-1',
    tenantId: 'tenant-1',
    fileKeys: [],
    sourceUrls: [],
    ...overrides
  }
}

// Mirrors the real readFullFileContent return shape: { text, fileName, charCount }
function file(fileName: string, text: string) {
  return { fileName, text, charCount: text.length }
}

// Mirrors the real fetchUrlContent (UrlContentResult) success shape.
function urlOk(url: string, title: string | null, textContent: string) {
  return { url, title, textContent, error: undefined }
}

beforeEach(() => {
  readFullFileContent.mockReset()
  fetchUrlContent.mockReset()
})

describe('DirectRetriever.prepare/dispose', () => {
  it('prepare and dispose are no-ops that resolve', async () => {
    const r = new DirectRetriever(cfg())
    await expect(r.prepare()).resolves.toBeUndefined()
    await expect(r.dispose()).resolves.toBeUndefined()
  })
})

describe('DirectRetriever.build — empty inputs', () => {
  it('returns empty context, no tools, no sources when nothing is configured', async () => {
    const r = new DirectRetriever(cfg())
    const result = await r.build()
    expect(result).toEqual({
      contextText: '',
      tools: [],
      sources: [],
      hasOverflow: false
    })
    expect(readFullFileContent).not.toHaveBeenCalled()
    expect(fetchUrlContent).not.toHaveBeenCalled()
  })

  it('never exposes any tools (direct strategy inlines content)', async () => {
    readFullFileContent.mockResolvedValue(file('a.txt', 'hello'))
    const r = new DirectRetriever(cfg({ fileKeys: ['a'] }))
    const result = await r.build()
    expect(result.tools).toEqual([])
  })
})

describe('DirectRetriever.build — file content', () => {
  it('inlines a single file into contextText with a [File: name] header', async () => {
    readFullFileContent.mockResolvedValue(file('notes.md', 'the body'))
    const r = new DirectRetriever(cfg({ fileKeys: ['key-1'] }))
    const result = await r.build()
    expect(readFullFileContent).toHaveBeenCalledWith('key-1')
    expect(result.contextText).toBe('[File: notes.md]\nthe body')
    expect(result.sources).toEqual(['notes.md'])
    expect(result.hasOverflow).toBe(false)
  })

  it('sorts included files by ascending charCount', async () => {
    readFullFileContent
      .mockResolvedValueOnce(file('big.txt', 'x'.repeat(100)))
      .mockResolvedValueOnce(file('small.txt', 'y'.repeat(10)))
    const r = new DirectRetriever(cfg({ fileKeys: ['big', 'small'] }))
    const result = await r.build()
    expect(result.sources).toEqual(['small.txt', 'big.txt'])
    expect(result.contextText.indexOf('small.txt')).toBeLessThan(
      result.contextText.indexOf('big.txt')
    )
  })

  it('joins multiple files with the \\n\\n---\\n\\n separator', async () => {
    readFullFileContent
      .mockResolvedValueOnce(file('a.txt', 'aaa'))
      .mockResolvedValueOnce(file('b.txt', 'bbb'))
    const r = new DirectRetriever(cfg({ fileKeys: ['a', 'b'] }))
    const result = await r.build()
    expect(result.contextText).toBe(
      '[File: a.txt]\naaa\n\n---\n\n[File: b.txt]\nbbb'
    )
  })

  it('skips files with zero charCount', async () => {
    readFullFileContent
      .mockResolvedValueOnce(file('empty.txt', ''))
      .mockResolvedValueOnce(file('real.txt', 'content'))
    const r = new DirectRetriever(cfg({ fileKeys: ['empty', 'real'] }))
    const result = await r.build()
    expect(result.sources).toEqual(['real.txt'])
    expect(result.contextText).toBe('[File: real.txt]\ncontent')
  })

  it('ignores rejected file reads (Promise.allSettled)', async () => {
    readFullFileContent
      .mockRejectedValueOnce(new Error('storage offline'))
      .mockResolvedValueOnce(file('ok.txt', 'survived'))
    const r = new DirectRetriever(cfg({ fileKeys: ['bad', 'good'] }))
    const result = await r.build()
    expect(result.sources).toEqual(['ok.txt'])
    expect(result.contextText).toBe('[File: ok.txt]\nsurvived')
    expect(result.hasOverflow).toBe(false)
  })
})

describe('DirectRetriever.build — file budget & overflow', () => {
  it('sets hasOverflow when a file would exceed the 60% file budget', async () => {
    readFullFileContent.mockResolvedValue(
      file('huge.txt', 'x'.repeat(FILE_BUDGET + 1))
    )
    const r = new DirectRetriever(cfg({ fileKeys: ['huge'] }))
    const result = await r.build()
    expect(result.hasOverflow).toBe(true)
    expect(result.sources).toEqual([])
    expect(result.contextText).toBe('')
  })

  it('includes a file exactly at the budget boundary (<= budget)', async () => {
    readFullFileContent.mockResolvedValue(
      file('exact.txt', 'x'.repeat(FILE_BUDGET))
    )
    const r = new DirectRetriever(cfg({ fileKeys: ['exact'] }))
    const result = await r.build()
    expect(result.hasOverflow).toBe(false)
    expect(result.sources).toEqual(['exact.txt'])
  })

  it('greedily packs ascending by size and overflows the file that no longer fits', async () => {
    // Files are sorted ascending by charCount, then packed in order:
    //   tiny  = 20           -> fits (20 <= 18000), used = 20
    //   bulky = budget - 10  -> 20 + 17990 = 18010 > 18000 -> overflows
    readFullFileContent
      .mockResolvedValueOnce(file('bulky.txt', 'b'.repeat(FILE_BUDGET - 10)))
      .mockResolvedValueOnce(file('tiny.txt', 't'.repeat(20)))
    const r = new DirectRetriever(cfg({ fileKeys: ['bulky', 'tiny'] }))
    const result = await r.build()
    // The tiny file is packed first (smaller); the bulky one overflows.
    expect(result.sources).toEqual(['tiny.txt'])
    expect(result.hasOverflow).toBe(true)
  })

  it('packs both files when their combined size is within the budget', async () => {
    readFullFileContent
      .mockResolvedValueOnce(file('a.txt', 'a'.repeat(5000)))
      .mockResolvedValueOnce(file('b.txt', 'b'.repeat(5000)))
    const r = new DirectRetriever(cfg({ fileKeys: ['a', 'b'] }))
    const result = await r.build()
    expect(result.sources).toEqual(['a.txt', 'b.txt'])
    expect(result.hasOverflow).toBe(false)
  })
})

describe('DirectRetriever.build — source URLs', () => {
  it('inlines successful URL content with [Source: title] header and URL line', async () => {
    fetchUrlContent.mockResolvedValue(
      urlOk('https://x.com/a', 'Doc Title', 'web body')
    )
    const r = new DirectRetriever(cfg({ sourceUrls: ['https://x.com/a'] }))
    const result = await r.build()
    expect(fetchUrlContent).toHaveBeenCalledWith('https://x.com/a')
    expect(result.contextText).toBe(
      '[Source: Doc Title]\nURL: https://x.com/a\nweb body'
    )
    expect(result.sources).toEqual(['https://x.com/a'])
  })

  it('falls back to the URL as label when title is empty/null', async () => {
    fetchUrlContent.mockResolvedValue(urlOk('https://x.com/b', null, 'body'))
    const r = new DirectRetriever(cfg({ sourceUrls: ['https://x.com/b'] }))
    const result = await r.build()
    expect(result.contextText).toBe(
      '[Source: https://x.com/b]\nURL: https://x.com/b\nbody'
    )
  })

  it('skips URL results that carry an error', async () => {
    fetchUrlContent.mockResolvedValue({
      url: 'https://x.com/c',
      title: undefined,
      textContent: 'should be ignored',
      error: 'Blocked URL host'
    })
    const r = new DirectRetriever(cfg({ sourceUrls: ['https://x.com/c'] }))
    const result = await r.build()
    expect(result.contextText).toBe('')
    expect(result.sources).toEqual([])
  })

  it('skips URL results with empty textContent', async () => {
    fetchUrlContent.mockResolvedValue(urlOk('https://x.com/d', 'T', ''))
    const r = new DirectRetriever(cfg({ sourceUrls: ['https://x.com/d'] }))
    const result = await r.build()
    expect(result.contextText).toBe('')
    expect(result.sources).toEqual([])
  })

  it('caps the number of fetched URLs at 5', async () => {
    fetchUrlContent.mockImplementation(async (url: string) => urlOk(url, null, 'c'))
    const sourceUrls = Array.from({ length: 8 }, (_, i) => `https://x.com/${i}`)
    const r = new DirectRetriever(cfg({ sourceUrls }))
    await r.build()
    expect(fetchUrlContent).toHaveBeenCalledTimes(5)
  })

  it('ignores rejected URL fetches (Promise.allSettled)', async () => {
    fetchUrlContent
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(urlOk('https://x.com/ok', 'Ok', 'body'))
    const r = new DirectRetriever(
      cfg({ sourceUrls: ['https://x.com/bad', 'https://x.com/ok'] })
    )
    const result = await r.build()
    expect(result.sources).toEqual(['https://x.com/ok'])
  })

  it('drops a URL whose content would push usedChars past MAX_CONTEXT_CHARS', async () => {
    readFullFileContent.mockResolvedValue(file('f.txt', 'f'.repeat(FILE_BUDGET)))
    fetchUrlContent.mockResolvedValue(
      urlOk(
        'https://x.com/u',
        'U',
        'u'.repeat(MAX_CONTEXT_CHARS - FILE_BUDGET + 1)
      )
    )
    const r = new DirectRetriever(
      cfg({ fileKeys: ['f'], sourceUrls: ['https://x.com/u'] })
    )
    const result = await r.build()
    expect(result.sources).toEqual(['f.txt'])
  })
})

describe('DirectRetriever.build — combined files + URLs ordering', () => {
  it('places file content before URL content in the joined context', async () => {
    readFullFileContent.mockResolvedValue(file('doc.txt', 'FILEDATA'))
    fetchUrlContent.mockResolvedValue(urlOk('https://x.com/u', 'U', 'URLDATA'))
    const r = new DirectRetriever(
      cfg({ fileKeys: ['doc'], sourceUrls: ['https://x.com/u'] })
    )
    const result = await r.build()
    expect(result.contextText.indexOf('FILEDATA')).toBeLessThan(
      result.contextText.indexOf('URLDATA')
    )
    expect(result.sources).toEqual(['doc.txt', 'https://x.com/u'])
  })
})
