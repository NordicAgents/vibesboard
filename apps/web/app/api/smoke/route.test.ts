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
  const smokeSecret = 'unit-test-smoke-secret-that-is-long-enough'

  it('is disabled when no smoke-test secret is configured', async () => {
    const previous = process.env.SMOKE_TEST_SECRET
    delete process.env.SMOKE_TEST_SECRET

    const res = await GET(new Request('http://localhost/api/smoke') as never)

    if (previous === undefined) delete process.env.SMOKE_TEST_SECRET
    else process.env.SMOKE_TEST_SECRET = previous

    expect(res.status).toBe(404)
  })

  it('rejects a request without the configured bearer secret', async () => {
    process.env.SMOKE_TEST_SECRET = smokeSecret
    const res = await GET(new Request('http://localhost/api/smoke') as never)
    expect(res.status).toBe(404)
  })

  it('returns 200 with a text/plain stream for an authorized request', async () => {
    process.env.SMOKE_TEST_SECRET = smokeSecret
    const res = await GET(
      new Request('http://localhost/api/smoke', {
        headers: { authorization: `Bearer ${smokeSecret}` }
      }) as never
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(await res.text()).toBe('smoke-ok')
  })

  it('accepts the web mode query param', async () => {
    process.env.SMOKE_TEST_SECRET = smokeSecret
    const res = await GET(
      new Request('http://localhost/api/smoke?mode=web', {
        headers: { authorization: `Bearer ${smokeSecret}` }
      }) as never
    )
    expect(res.status).toBe(200)
  })
})
