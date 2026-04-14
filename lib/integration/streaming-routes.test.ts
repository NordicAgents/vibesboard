/**
 * Deep streaming verification tests for all API routes.
 *
 * These tests make actual HTTP requests to the running Next.js dev server
 * and verify streaming behavior (multiple chunks, headers, cancellation).
 *
 * Before running, start the dev server:
 *   pnpm dev
 *
 * Then run:
 *   node --experimental-strip-types --test lib/integration/streaming-routes.test.ts
 *
 * Environment:
 *   BASE_URL — defaults to http://localhost:3000
 *   TEST_AUTH_COOKIE — session cookie for authenticated routes
 */
import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Load .env.local
function loadEnv() {
  try {
    const envPath = resolve(import.meta.dirname, '../../.env.local')
    const content = readFileSync(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex === -1) continue
      const key = trimmed.slice(0, eqIndex).trim()
      let value = trimmed.slice(eqIndex + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
  } catch {
    // .env.local not found
  }
}

loadEnv()

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const AUTH_COOKIE = process.env.TEST_AUTH_COOKIE ?? ''

async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/smoke`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    })
    return res.status !== 0
  } catch {
    return false
  }
}

function skipIfNotReady(): boolean {
  if (!AUTH_COOKIE) {
    console.log('  ⏭ Skipping: TEST_AUTH_COOKIE not set')
    return true
  }
  return false
}

// -------------------------------------------------------------------
// /api/chat — streaming depth checks
// -------------------------------------------------------------------
describe('POST /api/chat streaming', () => {
  test('receives multiple chunks (incremental streaming)', async () => {
    const running = await isServerRunning()
    if (!running || skipIfNotReady()) return

    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: AUTH_COOKIE
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: 'Write a short paragraph about the weather.'
          }
        ]
      })
    })

    assert.ok(res.ok, `Expected 200, got ${res.status}`)
    assert.ok(res.body, 'Response should have a body stream')

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let chunkCount = 0
    let fullText = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      chunkCount++
      fullText += decoder.decode(value, { stream: true })
    }

    assert.ok(chunkCount >= 2, `Expected multiple chunks, got ${chunkCount}`)
    assert.ok(fullText.length > 0, 'Should produce text')
  })

  test('Content-Type is text/plain or text/event-stream', async () => {
    const running = await isServerRunning()
    if (!running || skipIfNotReady()) return

    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: AUTH_COOKIE
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Say ok' }]
      })
    })

    if (res.ok) {
      const ct = res.headers.get('content-type') ?? ''
      assert.ok(
        ct.includes('text/plain') || ct.includes('text/event-stream'),
        `Expected text content type, got: ${ct}`
      )
    }

    // Consume to avoid hanging
    if (res.body) {
      const reader = res.body.getReader()
      while (!(await reader.read()).done) {}
    }
  })

  test('stream cancellation does not crash the server', async () => {
    const running = await isServerRunning()
    if (!running || skipIfNotReady()) return

    const controller = new AbortController()

    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: AUTH_COOKIE
      },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'Tell me a long story about a dragon.' }
        ]
      }),
      signal: controller.signal
    })

    assert.ok(res.ok)

    // Read first chunk then abort
    const reader = res.body!.getReader()
    await reader.read()
    controller.abort()

    // Give server a moment to handle cancellation
    await new Promise(r => setTimeout(r, 500))

    // Verify server still works after cancellation
    const healthCheck = await fetch(`${BASE_URL}/api/smoke`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    })
    assert.ok(
      healthCheck.status !== 0,
      'Server should still respond after stream cancel'
    )
  })
})

// -------------------------------------------------------------------
// /api/agent-helper — streaming check
// -------------------------------------------------------------------
describe('POST /api/agent-helper streaming', () => {
  test('receives multiple chunks', async () => {
    const running = await isServerRunning()
    if (!running || skipIfNotReady()) return

    const res = await fetch(`${BASE_URL}/api/agent-helper`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: AUTH_COOKIE
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: 'Write instructions for a customer service agent'
          }
        ]
      })
    })

    assert.ok(res.ok, `Expected 200, got ${res.status}`)

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let chunkCount = 0
    let fullText = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      chunkCount++
      fullText += decoder.decode(value, { stream: true })
    }

    assert.ok(chunkCount >= 2, `Expected multiple chunks, got ${chunkCount}`)
    assert.ok(fullText.length > 0, 'Should produce text')
  })
})

// -------------------------------------------------------------------
// /api/agent-creator — streaming + tool markers
// -------------------------------------------------------------------
describe('POST /api/agent-creator streaming', () => {
  test('streams a response with agent suggestions', async () => {
    const running = await isServerRunning()
    if (!running || skipIfNotReady()) return

    const res = await fetch(`${BASE_URL}/api/agent-creator`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: AUTH_COOKIE
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content:
              'Create a pizza delivery support agent called PizzaBot that helps customers track orders'
          }
        ]
      })
    })

    assert.ok(res.ok, `Expected 200, got ${res.status}`)

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let chunkCount = 0
    let fullText = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      chunkCount++
      fullText += decoder.decode(value, { stream: true })
    }

    assert.ok(chunkCount >= 2, `Expected multiple chunks, got ${chunkCount}`)
    assert.ok(fullText.length > 0, 'Should produce text')
    // The agent creator often produces an agentupdate block on the first detailed message
    // This is not guaranteed on every response, so we just verify streaming works
  })
})
