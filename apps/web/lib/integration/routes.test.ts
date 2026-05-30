import { describe, it, expect } from 'vitest'

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000'

// These hit a live Next dev server. Skipped by default; a later Playwright
// phase covers live flows. Enable by exporting TEST_LIVE_SERVER.
describe.skipIf(!process.env.TEST_LIVE_SERVER)('live API routes', () => {
  it('GET /api/health returns 200', async () => {
    const res = await fetch(`${BASE_URL}/api/health`)
    expect(res.status).toBe(200)
  })

  it('GET /api/agents requires auth', async () => {
    const res = await fetch(`${BASE_URL}/api/agents`)
    expect(res.status).toBe(401)
  })
})
