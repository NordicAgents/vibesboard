import { describe, it, expect } from 'vitest'

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000'

// Hits a live Next dev server with an authenticated cookie. Skipped by default;
// a later Playwright phase covers live flows. Enable by exporting both
// TEST_LIVE_SERVER and TEST_AUTH_COOKIE.
describe.skipIf(
  !process.env.TEST_LIVE_SERVER || !process.env.TEST_AUTH_COOKIE
)('live streaming routes', () => {
  it('POST /api/chat streams a response', async () => {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: process.env.TEST_AUTH_COOKIE as string
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] })
    })
    expect(res.ok).toBeTruthy()
  })
})
