/**
 * Integration tests for the API routes changed in the AI SDK v3 migration.
 *
 * These tests make actual HTTP requests to the running Next.js dev server.
 * Before running, start the dev server:
 *   bun run dev
 *
 * Then run:
 *   node --experimental-strip-types --test lib/integration/routes.test.ts
 *
 * Environment:
 *   BASE_URL — defaults to http://localhost:3000
 *   TEST_AUTH_COOKIE — session cookie for authenticated routes (see below)
 *
 * To get a session cookie:
 *   1. Log in to the app in your browser
 *   2. Copy the full Cookie header value from a request in DevTools
 *   3. Set TEST_AUTH_COOKIE="__session=<value>"
 */
import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Load .env.local
function loadEnv() {
  try {
    const envPath = fileURLToPath(new URL('../../.env.local', import.meta.url))
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

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002'
const AUTH_COOKIE = process.env.TEST_AUTH_COOKIE ?? ''

async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/smoke`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    })
    return res.ok
  } catch {
    return false
  }
}

async function consumeStream(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  return text
}

// -------------------------------------------------------------------
// /api/chat — general chat route
// -------------------------------------------------------------------
describe('POST /api/chat', () => {
  test('returns 401 without auth', async () => {
    const running = await isServerRunning()
    if (!running) {
      console.log('  ⏭ Skipping: dev server not running at ' + BASE_URL)
      return
    }

    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }]
      })
    })

    assert.strictEqual(res.status, 401)
  })

  test('streams a response with valid auth', async () => {
    const running = await isServerRunning()
    if (!running || !AUTH_COOKIE) {
      console.log(
        '  ⏭ Skipping: dev server not running or TEST_AUTH_COOKIE not set'
      )
      return
    }

    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: AUTH_COOKIE
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Say exactly: ROUTE_TEST_OK' }]
      })
    })

    assert.ok(
      [200, 201].includes(res.status),
      `Expected 200, got ${res.status}`
    )

    const text = await consumeStream(res)
    assert.ok(text.length > 0, 'Should stream some text')
  })
})

// -------------------------------------------------------------------
// /api/agent-helper — agent instruction helper
// -------------------------------------------------------------------
describe('POST /api/agent-helper', () => {
  test('returns 401 without auth', async () => {
    const running = await isServerRunning()
    if (!running) {
      console.log('  ⏭ Skipping: dev server not running')
      return
    }

    const res = await fetch(`${BASE_URL}/api/agent-helper`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Help me build a support agent' }]
      })
    })

    assert.strictEqual(res.status, 401)
  })

  test('streams a response with valid auth', async () => {
    const running = await isServerRunning()
    if (!running || !AUTH_COOKIE) {
      console.log(
        '  ⏭ Skipping: dev server not running or TEST_AUTH_COOKIE not set'
      )
      return
    }

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
            content: 'Create instructions for a fitness coach agent'
          }
        ]
      })
    })

    assert.ok(
      [200, 201].includes(res.status),
      `Expected 200, got ${res.status}`
    )

    const text = await consumeStream(res)
    assert.ok(text.length > 0, 'Should stream some text')
  })
})

// -------------------------------------------------------------------
// /api/agent-creator — agent creator with tool calling
// -------------------------------------------------------------------
describe('POST /api/agent-creator', () => {
  test('returns 401 without auth', async () => {
    const running = await isServerRunning()
    if (!running) {
      console.log('  ⏭ Skipping: dev server not running')
      return
    }

    const res = await fetch(`${BASE_URL}/api/agent-creator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Create a support agent' }]
      })
    })

    assert.strictEqual(res.status, 401)
  })

  test('streams a response with valid auth', async () => {
    const running = await isServerRunning()
    if (!running || !AUTH_COOKIE) {
      console.log(
        '  ⏭ Skipping: dev server not running or TEST_AUTH_COOKIE not set'
      )
      return
    }

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
              'I want to create a FAQ bot for my coffee shop called Bean There.'
          }
        ]
      })
    })

    assert.ok(
      [200, 201].includes(res.status),
      `Expected 200, got ${res.status}`
    )

    const text = await consumeStream(res)
    assert.ok(text.length > 0, 'Should stream some text')
  })
})

// -------------------------------------------------------------------
// Response headers check (Content-Type)
// -------------------------------------------------------------------
describe('Response headers', () => {
  test('/api/chat returns text/plain content type', async () => {
    const running = await isServerRunning()
    if (!running || !AUTH_COOKIE) {
      console.log(
        '  ⏭ Skipping: dev server not running or TEST_AUTH_COOKIE not set'
      )
      return
    }

    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: AUTH_COOKIE
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }]
      })
    })

    if (res.ok) {
      const contentType = res.headers.get('content-type') ?? ''
      assert.ok(
        contentType.includes('text/plain') ||
          contentType.includes('text/event-stream'),
        `Expected text content type, got: ${contentType}`
      )
    }

    await consumeStream(res)
  })
})
