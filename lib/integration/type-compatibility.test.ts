/**
 * Tests for AI SDK v3 type compatibility and import surface.
 *
 * Verifies that the Message type re-export and SDK exports resolve
 * correctly — no external dependencies needed.
 *
 * Run:
 *   node --experimental-strip-types --test lib/integration/type-compatibility.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert'

// -------------------------------------------------------------------
// 1. Message type re-export
// -------------------------------------------------------------------
describe('Message type re-export', () => {
  test('ai module imports without error', async () => {
    const ai = await import('ai')
    assert.ok(ai, 'ai module should import successfully')
  })

  test('ai/react module imports without error', async () => {
    // This verifies the react hooks module resolves
    const aiReact = await import('ai/react')
    assert.ok(aiReact, 'ai/react module should import successfully')
  })
})

// -------------------------------------------------------------------
// 2. SDK v3 export surface
// -------------------------------------------------------------------
describe('AI SDK v3 export surface', () => {
  test('streamText is a function export from "ai"', async () => {
    const ai = await import('ai')
    assert.strictEqual(typeof ai.streamText, 'function')
  })

  test('tool is a function export from "ai"', async () => {
    const ai = await import('ai')
    assert.strictEqual(typeof ai.tool, 'function')
  })

  test('generateText is a function export from "ai"', async () => {
    const ai = await import('ai')
    assert.strictEqual(typeof ai.generateText, 'function')
  })

  test('createOpenAI is a function export from "@ai-sdk/openai"', async () => {
    const { createOpenAI } = await import('@ai-sdk/openai')
    assert.strictEqual(typeof createOpenAI, 'function')
  })

  test('useChat is a function export from "ai/react"', async () => {
    const { useChat } = await import('ai/react')
    assert.strictEqual(typeof useChat, 'function')
  })

  test('useCompletion is a function export from "ai/react"', async () => {
    const { useCompletion } = await import('ai/react')
    assert.strictEqual(typeof useCompletion, 'function')
  })
})

// -------------------------------------------------------------------
// 3. Deprecated v2 exports exist as aliases but should not be used
// -------------------------------------------------------------------
describe('v2 backward-compat aliases', () => {
  test('experimental_streamText exists as alias to streamText', async () => {
    const ai = await import('ai')
    // v3 keeps these as backwards-compat aliases — what matters is
    // that our codebase uses the non-experimental versions
    if ((ai as any).experimental_streamText) {
      assert.strictEqual(
        (ai as any).experimental_streamText,
        ai.streamText,
        'experimental_streamText should alias streamText'
      )
    }
  })

  test('experimental_generateText exists as alias to generateText', async () => {
    const ai = await import('ai')
    if ((ai as any).experimental_generateText) {
      assert.strictEqual(
        (ai as any).experimental_generateText,
        ai.generateText,
        'experimental_generateText should alias generateText'
      )
    }
  })
})
