import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock only the @vibesboard/ai data layer (S3/OpenAI adapters + network).
// We deliberately use the REAL `just-bash` so the sandbox, virtual FS, command
// execution, exit codes and stderr behave exactly as in production.
const readFullFileContent = vi.fn()
const fetchUrlContent = vi.fn()

vi.mock('@vibesboard/ai/file-search', () => ({
  readFullFileContent: (...args: unknown[]) => readFullFileContent(...args)
}))
vi.mock('@vibesboard/ai/fetch-url-content', () => ({
  fetchUrlContent: (...args: unknown[]) => fetchUrlContent(...args)
}))

import { BashRetriever } from './bash.ts'
import { type RetrieverConfig } from '../types.ts'

const PROJECT_DIR = '/home/user/project'
const MAX_COMMAND_LENGTH = 4_000
const MAX_OUTPUT_CHARS = 8_000
const MAX_FILE_CHARS = 200_000

function cfg(overrides: Partial<RetrieverConfig> = {}): RetrieverConfig {
  return {
    agentId: 'agent-1',
    tenantId: 'tenant-1',
    fileKeys: [],
    sourceUrls: [],
    ...overrides
  }
}

function file(fileName: string, text: string) {
  return { fileName, text, charCount: text.length }
}

function urlOk(url: string, title: string | null, textContent: string) {
  return { url, title, textContent, error: undefined }
}

beforeEach(() => {
  readFullFileContent.mockReset()
  fetchUrlContent.mockReset()
})

describe('BashRetriever.prepare — no files', () => {
  it('does not create a sandbox when there are no file keys', async () => {
    const r = new BashRetriever(cfg({ fileKeys: [] }))
    await r.prepare()
    const result = await r.build()
    expect(result.tools).toEqual([])
    expect(readFullFileContent).not.toHaveBeenCalled()
  })
})

describe('BashRetriever.build — bash tool exposure', () => {
  it('exposes a single bash tool when at least one file is loaded', async () => {
    readFullFileContent.mockResolvedValue(file('data.csv', 'a,b\n1,2\n'))
    const r = new BashRetriever(cfg({ fileKeys: ['k1'] }))
    await r.prepare()
    const result = await r.build()
    expect(result.tools).toHaveLength(1)
    const tool = result.tools[0]
    expect(tool.function.name).toBe('bash')
    expect(tool.function.parameters.required).toEqual(['command'])
    expect(tool.function.parameters.properties).toHaveProperty('command')
  })

  it('injects a virtual-FS hint listing the available files into contextText', async () => {
    readFullFileContent
      .mockResolvedValueOnce(file('one.txt', 'first'))
      .mockResolvedValueOnce(file('two.txt', 'second'))
    const r = new BashRetriever(cfg({ fileKeys: ['a', 'b'] }))
    await r.prepare()
    const result = await r.build()
    expect(result.contextText).toContain('sandboxed virtual filesystem')
    expect(result.contextText).toContain(`${PROJECT_DIR}/one.txt`)
    expect(result.contextText).toContain(`${PROJECT_DIR}/two.txt`)
  })

  it('build() without prepare() returns no tools (sandbox uninitialised)', async () => {
    readFullFileContent.mockResolvedValue(file('x.txt', 'data'))
    const r = new BashRetriever(cfg({ fileKeys: ['k1'] }))
    // Intentionally skip prepare().
    const result = await r.build()
    expect(result.tools).toEqual([])
    expect(result.contextText).toBe('')
  })
})

describe('BashRetriever.prepare — file filtering & sanitisation', () => {
  it('skips files whose content is blank/whitespace-only', async () => {
    readFullFileContent
      .mockResolvedValueOnce(file('blank.txt', '   \n  '))
      .mockResolvedValueOnce(file('real.txt', 'content'))
    const r = new BashRetriever(cfg({ fileKeys: ['blank', 'real'] }))
    await r.prepare()
    const result = await r.build()
    expect(result.contextText).toContain(`${PROJECT_DIR}/real.txt`)
    expect(result.contextText).not.toContain('blank.txt')
  })

  it('ignores rejected file reads (Promise.allSettled)', async () => {
    readFullFileContent
      .mockRejectedValueOnce(new Error('storage down'))
      .mockResolvedValueOnce(file('ok.txt', 'survived'))
    const r = new BashRetriever(cfg({ fileKeys: ['bad', 'ok'] }))
    await r.prepare()
    const result = await r.build()
    expect(result.contextText).toContain('ok.txt')
    expect(result.tools).toHaveLength(1)
  })

  it('sanitises dangerous filenames (path traversal / special chars)', async () => {
    readFullFileContent.mockResolvedValue(file('../../etc/passwd', 'root:x:0:0'))
    const r = new BashRetriever(cfg({ fileKeys: ['evil'] }))
    await r.prepare()
    const result = await r.build()
    // No raw traversal sequence (slashes or '..') survives into the listing.
    expect(result.contextText).not.toContain('../../etc/passwd')
    expect(result.contextText).not.toContain('/etc/passwd')
    // sanitiseFileName applies, in order:
    //   1. allowlist: every '/' -> '_'  => '.._.._etc_passwd'
    //   2. collapse runs of dots '..' -> '.'  => '._._etc_passwd'
    //   3. strip leading dots  => '_._etc_passwd'
    // So the path segment is a single safe token with no separators.
    expect(result.contextText).toContain(`${PROJECT_DIR}/_._etc_passwd`)
  })

  it('falls back to "file" when a name sanitises to empty', async () => {
    readFullFileContent.mockResolvedValue(file('...', 'body'))
    const r = new BashRetriever(cfg({ fileKeys: ['weird'] }))
    await r.prepare()
    const result = await r.build()
    expect(result.contextText).toContain(`${PROJECT_DIR}/file`)
  })

  it('reads a sanitised file back through the real bash sandbox', async () => {
    readFullFileContent.mockResolvedValue(
      file('hello world.txt', 'sandbox-body')
    )
    const r = new BashRetriever(cfg({ fileKeys: ['k'] }))
    await r.prepare()
    const result = await r.build()
    const tool = result.tools[0]
    // Space -> underscore in the sanitised name.
    const out = await tool.execute(
      { command: `cat ${PROJECT_DIR}/hello_world.txt` },
      {}
    )
    expect(out).toBe('sandbox-body')
  })

  it('truncates file content beyond MAX_FILE_CHARS before writing to the FS', async () => {
    // The retriever slices content to MAX_FILE_CHARS before writing to the VFS.
    // Put a marker at the very start (kept) and another after the cut point
    // (dropped). head -c / tail -c are deterministic in just-bash, so we use
    // them to inspect the actual stored bytes at both ends.
    const startMarker = 'START_MARKER'
    const endMarker = 'END_TAIL_MARKER'
    const filler = 'x'.repeat(MAX_FILE_CHARS) // pushes endMarker past the cap
    const huge = startMarker + filler + endMarker
    readFullFileContent.mockResolvedValue(file('huge.txt', huge))
    const r = new BashRetriever(cfg({ fileKeys: ['k'] }))
    await r.prepare()
    const result = await r.build()
    const tool = result.tools[0]

    // The start marker survives at the head of the stored content.
    const head = await tool.execute(
      { command: `head -c ${startMarker.length} ${PROJECT_DIR}/huge.txt` },
      {}
    )
    expect(head).toBe(startMarker)

    // The trailing marker sat beyond MAX_FILE_CHARS and was sliced off, so the
    // stored tail is plain filler, not the original end marker.
    const tail = await tool.execute(
      { command: `tail -c ${endMarker.length} ${PROJECT_DIR}/huge.txt` },
      {}
    )
    expect(tail).not.toContain(endMarker)
    expect(tail).toMatch(/^x+$/)
  })
})

describe('BashRetriever bash tool — execute (real just-bash)', () => {
  async function toolWith(files: Array<[string, string]>) {
    let i = 0
    readFullFileContent.mockImplementation(async () => {
      const [name, text] = files[i++]
      return file(name, text)
    })
    const r = new BashRetriever(cfg({ fileKeys: files.map((_, idx) => `k${idx}`) }))
    await r.prepare()
    const result = await r.build()
    return result.tools[0]
  }

  it('runs a grep filter against an uploaded file', async () => {
    const tool = await toolWith([['log.txt', 'apple\nbanana\napple\n']])
    const out = await tool.execute(
      { command: `grep apple ${PROJECT_DIR}/log.txt` },
      {}
    )
    // grep returns the matching lines (and only those) from the sandboxed file.
    expect(out).toContain('apple')
    expect(out).not.toContain('banana')
  })

  it('lists uploaded files via ls', async () => {
    const tool = await toolWith([
      ['a.txt', 'aa'],
      ['b.txt', 'bb']
    ])
    const out = await tool.execute({ command: `ls ${PROJECT_DIR}` }, {})
    expect(out).toContain('a.txt')
    expect(out).toContain('b.txt')
  })

  it('returns "No command provided." for an empty/whitespace/missing command', async () => {
    const tool = await toolWith([['a.txt', 'x']])
    expect(await tool.execute({ command: '' }, {})).toBe('No command provided.')
    expect(await tool.execute({ command: '   ' }, {})).toBe(
      'No command provided.'
    )
    expect(await tool.execute({}, {})).toBe('No command provided.')
  })

  it('reports a failed command (non-zero exit, no stdout) with its stderr', async () => {
    const tool = await toolWith([['a.txt', 'x']])
    const out = await tool.execute(
      { command: `cat ${PROJECT_DIR}/does-not-exist.txt` },
      {}
    )
    expect(out).toMatch(/^Command failed \(exit \d+\)/)
    expect(out).toContain('No such file or directory')
  })

  it('returns "(no output)" when a command succeeds but prints nothing', async () => {
    const tool = await toolWith([['a.txt', 'x']])
    const out = await tool.execute({ command: 'true' }, {})
    expect(out).toBe('(no output)')
  })

  it('persists files written during one bash call for subsequent calls', async () => {
    const tool = await toolWith([['seed.txt', 'seed']])
    await tool.execute({ command: `echo persisted > ${PROJECT_DIR}/new.txt` }, {})
    const out = await tool.execute({ command: `cat ${PROJECT_DIR}/new.txt` }, {})
    expect(out.trim()).toBe('persisted')
  })

  it('caps stdout output at MAX_OUTPUT_CHARS', async () => {
    // just-bash returns the full file content (no internal cap), so the
    // retriever's own slice(0, MAX_OUTPUT_CHARS) is what bounds the result.
    const big = 'x'.repeat(MAX_OUTPUT_CHARS + 5000)
    const tool = await toolWith([['big.txt', big]])
    const out = await tool.execute({ command: `cat ${PROJECT_DIR}/big.txt` }, {})
    expect(out.length).toBe(MAX_OUTPUT_CHARS)
    // The slice contains only the file's own bytes (no stderr marker appended).
    expect(out).toMatch(/^x+$/)
  })

  it('truncates an overly long command to MAX_COMMAND_LENGTH before executing', async () => {
    const tool = await toolWith([['a.txt', 'hello']])
    // `echo ok` followed by a long shell comment of non-whitespace chars. The
    // tail survives `.trim()` (it is not whitespace) and pushes the raw command
    // well past MAX_COMMAND_LENGTH, so the retriever slices it to 4000 chars
    // before executing. The truncated command still parses as `echo ok #...`.
    const raw = `echo ok #${'A'.repeat(MAX_COMMAND_LENGTH + 1000)}`
    expect(raw.length).toBeGreaterThan(MAX_COMMAND_LENGTH)
    const out = await tool.execute({ command: raw }, {})
    expect(out.trim()).toBe('ok')
  })
})

describe('BashRetriever.build — source URLs', () => {
  it('loads source URLs into context even alongside the bash tool', async () => {
    readFullFileContent.mockResolvedValue(file('f.txt', 'filedata'))
    fetchUrlContent.mockResolvedValue(urlOk('https://x.com/a', 'T', 'urldata'))
    const r = new BashRetriever(
      cfg({ fileKeys: ['k'], sourceUrls: ['https://x.com/a'] })
    )
    await r.prepare()
    const result = await r.build()
    expect(result.contextText).toContain('urldata')
    expect(result.sources).toEqual(['https://x.com/a'])
    expect(result.tools).toHaveLength(1)
  })

  it('places the FS hint before URL context in the joined output', async () => {
    readFullFileContent.mockResolvedValue(file('f.txt', 'filedata'))
    fetchUrlContent.mockResolvedValue(urlOk('https://x.com/a', 'T', 'urldata'))
    const r = new BashRetriever(
      cfg({ fileKeys: ['k'], sourceUrls: ['https://x.com/a'] })
    )
    await r.prepare()
    const result = await r.build()
    expect(result.contextText.indexOf('virtual filesystem')).toBeLessThan(
      result.contextText.indexOf('urldata')
    )
  })

  it('caps URL fetches at 5', async () => {
    readFullFileContent.mockResolvedValue(file('f.txt', 'x'))
    fetchUrlContent.mockImplementation(async (url: string) => urlOk(url, null, 'c'))
    const sourceUrls = Array.from({ length: 9 }, (_, i) => `https://x.com/${i}`)
    const r = new BashRetriever(cfg({ fileKeys: ['k'], sourceUrls }))
    await r.prepare()
    await r.build()
    expect(fetchUrlContent).toHaveBeenCalledTimes(5)
  })

  it('returns only URL context (no tools) when there are URLs but no files', async () => {
    fetchUrlContent.mockResolvedValue(urlOk('https://x.com/a', 'T', 'urldata'))
    const r = new BashRetriever(
      cfg({ fileKeys: [], sourceUrls: ['https://x.com/a'] })
    )
    await r.prepare()
    const result = await r.build()
    expect(result.tools).toEqual([])
    expect(result.contextText).toContain('urldata')
    expect(result.sources).toEqual(['https://x.com/a'])
  })
})

describe('BashRetriever.dispose', () => {
  it('clears the sandbox so build() afterwards exposes no tools', async () => {
    readFullFileContent.mockResolvedValue(file('a.txt', 'data'))
    const r = new BashRetriever(cfg({ fileKeys: ['k'] }))
    await r.prepare()
    await r.dispose()
    const result = await r.build()
    expect(result.tools).toEqual([])
  })
})
