/**
 * Tests for lib/openai-compat.ts — the lightweight OpenAI API helpers
 * that replace openai-edge.
 *
 * Unit tests verify the module shape and error handling.
 * Live tests (skipped without a real API key) verify actual API calls.
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
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = value
    }
  } catch { /* ignore */ }
}

loadEnv()

function hasRealApiKey(): boolean {
  const key = process.env.OPENAI_API_KEY
  return !!key && key.startsWith('sk-') && key.length >= 40
}

// -------------------------------------------------------------------
// Module exports
// -------------------------------------------------------------------
describe('openai-compat module', () => {
  test('exports chatCompletion function', async () => {
    const mod = await import('../openai-compat.ts')
    assert.strictEqual(typeof mod.chatCompletion, 'function')
  })

  test('exports createEmbedding function', async () => {
    const mod = await import('../openai-compat.ts')
    assert.strictEqual(typeof mod.createEmbedding, 'function')
  })

  test('exports chatCompletionWithVision function', async () => {
    const mod = await import('../openai-compat.ts')
    assert.strictEqual(typeof mod.chatCompletionWithVision, 'function')
  })
})

// -------------------------------------------------------------------
// Error handling (no API key)
// -------------------------------------------------------------------
describe('openai-compat error handling', () => {
  test('chatCompletion throws when OPENAI_API_KEY is missing', async () => {
    const originalKey = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY

    const mod = await import('../openai-compat.ts')
    try {
      await assert.rejects(
        () => mod.chatCompletion({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'hi' }]
        }),
        { message: /OPENAI_API_KEY/ }
      )
    } finally {
      if (originalKey) process.env.OPENAI_API_KEY = originalKey
    }
  })

  test('createEmbedding throws when OPENAI_API_KEY is missing', async () => {
    const originalKey = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY

    const mod = await import('../openai-compat.ts')
    try {
      await assert.rejects(
        () => mod.createEmbedding({
          model: 'text-embedding-3-small',
          input: 'test'
        }),
        { message: /OPENAI_API_KEY/ }
      )
    } finally {
      if (originalKey) process.env.OPENAI_API_KEY = originalKey
    }
  })
})

// -------------------------------------------------------------------
// Live API tests (skipped without real key)
// -------------------------------------------------------------------
describe('openai-compat live API', () => {
  test('chatCompletion returns valid response', async () => {
    if (!hasRealApiKey()) {
      console.log('  ⏭ Skipping: no real OPENAI_API_KEY')
      return
    }
    const mod = await import('../openai-compat.ts')
    const result = await mod.chatCompletion({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Reply with exactly: COMPAT_OK' },
        { role: 'user', content: 'Go.' }
      ],
      temperature: 0,
      max_tokens: 20
    })

    assert.ok(result.choices, 'Response should have choices')
    assert.ok(result.choices.length > 0, 'Should have at least one choice')
    assert.ok(
      result.choices[0].message.content.includes('COMPAT_OK'),
      `Expected COMPAT_OK, got: ${result.choices[0].message.content}`
    )
  })

  test('createEmbedding returns vectors', async () => {
    if (!hasRealApiKey()) {
      console.log('  ⏭ Skipping: no real OPENAI_API_KEY')
      return
    }
    const mod = await import('../openai-compat.ts')
    const result = await mod.createEmbedding({
      model: 'text-embedding-3-small',
      input: 'Hello world'
    })

    assert.ok(result.data, 'Response should have data')
    assert.ok(result.data.length > 0, 'Should have at least one embedding')
    assert.ok(Array.isArray(result.data[0].embedding), 'Embedding should be an array')
    assert.ok(result.data[0].embedding.length > 100, 'Embedding vector should have many dimensions')
  })
})
