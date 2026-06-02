// In-process route-handler test for the smoke endpoint. The route builds an
// in-memory agent and pipes runAgentStream into a Response; we stub the AI
// runtime so the handler is exercised end to end (request parsing, headers,
// response wiring) without any model/network calls.
import { describe, it, expect, vi } from 'vitest'

vi.mock('@vibesboard/ai/runtime', () => ({
  runAgentStream: async () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('smoke-ok'))
        controller.close()
      }
    })
}))

const { GET } = await import('./route.ts')

describe('GET /api/smoke', () => {
  it('returns 200 with a text/plain stream (default file mode)', async () => {
    const res = await GET(new Request('http://localhost/api/smoke') as never)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(await res.text()).toBe('smoke-ok')
  })

  it('accepts the web mode query param', async () => {
    const res = await GET(
      new Request('http://localhost/api/smoke?mode=web') as never
    )
    expect(res.status).toBe(200)
  })
})
