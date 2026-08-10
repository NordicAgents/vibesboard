import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteAgentFile, fetchAgentFileKeys } from './agent-files-client.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('agent file client', () => {
  it('does not treat a failed delete response as success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'Storage unavailable' }), {
            status: 500,
            headers: { 'content-type': 'application/json' }
          })
      )
    )

    await expect(deleteAgentFile('agent-1', 'owner/file.txt')).rejects.toThrow(
      'Storage unavailable'
    )
  })

  it('derives the visible keys from the files API response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          files: [{ fileKey: 'owner/a.txt' }, { fileKey: 'owner/b.txt' }]
        })
      )
    )

    await expect(fetchAgentFileKeys('agent-1')).resolves.toEqual([
      'owner/a.txt',
      'owner/b.txt'
    ])
  })
})
