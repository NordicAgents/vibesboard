import { describe, expect, it, vi } from 'vitest'

import { buildNvidiaFetch } from './nvidia-stream-adapter.ts'

describe('buildNvidiaFetch', () => {
  it('delegates transport to the supplied SSRF-safe fetch implementation', async () => {
    const response = new Response('{"ok":true}', {
      headers: { 'content-type': 'application/json' }
    })
    const safeTransport = vi.fn(async () => response) as unknown as typeof fetch
    const nvidiaFetch = buildNvidiaFetch(safeTransport)

    await expect(
      nvidiaFetch('https://nim.example.test/v1/chat/completions', {
        method: 'POST'
      })
    ).resolves.toBe(response)
    expect(safeTransport).toHaveBeenCalledOnce()
  })
})
