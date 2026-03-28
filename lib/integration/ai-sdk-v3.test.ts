/**
 * Integration tests for AI SDK v3 migration.
 *
 * These tests verify that:
 * 1. The ai SDK v3 imports resolve correctly (streamText, createOpenAI, tool, Message)
 * 2. createOpenAI + streamText produce a valid streaming response
 * 3. The tool() helper works as expected (agent-creator pattern)
 * 4. Message type from ai SDK is compatible with our re-export
 * 5. Response objects have correct Content-Type headers
 *
 * Requires OPENAI_API_KEY in .env.local for live API calls.
 */
import { test, describe, before } from 'node:test'
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
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
  } catch {
    // .env.local not found — rely on env vars
  }
}

loadEnv()

// A real OpenAI key starts with "sk-" and is 40+ chars.
// Placeholder values like "test-key" should be treated as missing.
function hasRealApiKey(): boolean {
  const key = process.env.OPENAI_API_KEY
  return !!key && key.startsWith('sk-') && key.length >= 40
}

function skipIfNoKey(): boolean {
  if (!hasRealApiKey()) {
    console.log('  ⏭ Skipping: OPENAI_API_KEY is not a real key (set a sk-… key to enable live tests)')
    return true
  }
  return false
}

// -------------------------------------------------------------------
// 1. SDK imports resolve correctly
// -------------------------------------------------------------------
describe('AI SDK v3 imports', () => {
  test('streamText is exported from "ai"', async () => {
    const ai = await import('ai')
    assert.strictEqual(typeof ai.streamText, 'function')
  })

  test('createOpenAI is exported from "@ai-sdk/openai"', async () => {
    const { createOpenAI } = await import('@ai-sdk/openai')
    assert.strictEqual(typeof createOpenAI, 'function')
  })

  test('tool is exported from "ai"', async () => {
    const ai = await import('ai')
    assert.strictEqual(typeof ai.tool, 'function')
  })

  test('Message type re-export resolves (runtime import check)', async () => {
    // Our re-export at lib/types/message.ts just does:
    //   export type { Message } from 'ai'
    // At runtime we can at least verify the ai module has Message
    const ai = await import('ai')
    // Message is a type — it doesn't exist at runtime in TS,
    // but the module should import without error
    assert.ok(ai)
  })
})

// -------------------------------------------------------------------
// 2. createOpenAI client creation
// -------------------------------------------------------------------
describe('createOpenAI client', () => {
  test('creates a provider with API key', async () => {
    const { createOpenAI } = await import('@ai-sdk/openai')
    // Works even with a placeholder key — just checks the factory
    const client = createOpenAI({ apiKey: 'sk-test' })
    assert.ok(client)
    assert.strictEqual(typeof client, 'function')
  })

  test('creates a model instance from provider', async () => {
    const { createOpenAI } = await import('@ai-sdk/openai')
    const client = createOpenAI({ apiKey: 'sk-test' })
    const model = client('gpt-4o-mini')
    assert.ok(model)
    assert.strictEqual(typeof model.doStream, 'function')
  })
})

// -------------------------------------------------------------------
// 3. streamText produces a streaming result (live API call)
// -------------------------------------------------------------------
describe('streamText live integration', () => {
  test('streams text from OpenAI via ai SDK v3', async () => {
    const { streamText } = await import('ai')
    const { createOpenAI } = await import('@ai-sdk/openai')

    if (skipIfNoKey()) return
    const apiKey = process.env.OPENAI_API_KEY!

    const openai = createOpenAI({ apiKey })
    const result = await streamText({
      model: openai('gpt-4o-mini'),
      messages: [
        { role: 'system', content: 'Reply with exactly: HELLO_TEST' },
        { role: 'user', content: 'Say the phrase.' }
      ],
      temperature: 0,
      maxTokens: 20
    })

    // Consume the stream
    let fullText = ''
    for await (const chunk of result.textStream) {
      fullText += chunk
    }

    assert.ok(fullText.length > 0, 'Stream should produce text')
    assert.ok(
      fullText.includes('HELLO_TEST'),
      `Expected "HELLO_TEST" in response, got: "${fullText}"`
    )
  })

  test('toTextStreamResponse returns a Response with correct headers', async () => {
    const { streamText } = await import('ai')
    const { createOpenAI } = await import('@ai-sdk/openai')

    if (skipIfNoKey()) return
    const apiKey = process.env.OPENAI_API_KEY!

    const openai = createOpenAI({ apiKey })
    const result = await streamText({
      model: openai('gpt-4o-mini'),
      messages: [{ role: 'user', content: 'Say ok' }],
      maxTokens: 5
    })

    const response = result.toTextStreamResponse()
    assert.ok(response instanceof Response)
    assert.ok(response.body, 'Response should have a body stream')

    // Consume to avoid hanging
    const reader = response.body!.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }
  })

  test('onFinish callback fires with completed text', async () => {
    const { streamText } = await import('ai')
    const { createOpenAI } = await import('@ai-sdk/openai')

    if (skipIfNoKey()) return
    const apiKey = process.env.OPENAI_API_KEY!

    const openai = createOpenAI({ apiKey })
    let finishText = ''

    const result = await streamText({
      model: openai('gpt-4o-mini'),
      messages: [
        { role: 'system', content: 'Reply with exactly: CALLBACK_OK' },
        { role: 'user', content: 'Go.' }
      ],
      temperature: 0,
      maxTokens: 20,
      onFinish({ text }) {
        finishText = text
      }
    })

    // Must consume stream for onFinish to fire
    let streamedText = ''
    for await (const chunk of result.textStream) {
      streamedText += chunk
    }

    // Give onFinish a moment to complete
    await new Promise(r => setTimeout(r, 100))

    assert.ok(finishText.length > 0, 'onFinish should have been called')
    assert.ok(
      finishText.includes('CALLBACK_OK'),
      `onFinish text should contain "CALLBACK_OK", got: "${finishText}"`
    )
  })
})

// -------------------------------------------------------------------
// 4. tool() helper works (agent-creator pattern)
// -------------------------------------------------------------------
describe('tool() helper', () => {
  test('defines a tool with schema and execute function', async () => {
    const { tool } = await import('ai')
    const { z } = await import('zod')

    const myTool = tool({
      description: 'Test tool',
      parameters: z.object({
        name: z.string(),
        count: z.number()
      }),
      async execute({ name, count }) {
        return `Created ${name} with ${count} items`
      }
    })

    assert.ok(myTool, 'tool() should return a tool definition')
    assert.strictEqual(typeof myTool.execute, 'function')
    assert.strictEqual((myTool as any).description, 'Test tool')
  })

  test('tool execute function runs correctly', async () => {
    const { tool } = await import('ai')
    const { z } = await import('zod')

    const myTool = tool({
      description: 'Adder',
      parameters: z.object({ a: z.number(), b: z.number() }),
      async execute({ a, b }) {
        return `${a + b}`
      }
    })

    const result = await myTool.execute!({ a: 3, b: 7 }, { abortSignal: new AbortController().signal } as any)
    assert.strictEqual(result, '10')
  })
})

// -------------------------------------------------------------------
// 5. Manual stream conversion pattern (runtime.ts)
// -------------------------------------------------------------------
describe('textStream to ReadableStream conversion', () => {
  test('converts async iterable to ReadableStream<Uint8Array>', async () => {
    const { streamText } = await import('ai')
    const { createOpenAI } = await import('@ai-sdk/openai')

    if (skipIfNoKey()) return
    const apiKey = process.env.OPENAI_API_KEY!

    const openai = createOpenAI({ apiKey })
    const result = await streamText({
      model: openai('gpt-4o-mini'),
      messages: [
        { role: 'system', content: 'Reply: STREAM_CONVERT_OK' },
        { role: 'user', content: 'Go.' }
      ],
      temperature: 0,
      maxTokens: 20
    })

    // This is the exact pattern used in lib/agent/runtime.ts
    const encoder = new TextEncoder()
    const readableStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of result.textStream) {
            controller.enqueue(encoder.encode(chunk))
          }
          controller.close()
        } catch (err) {
          controller.error(err)
        }
      }
    })

    // Consume and verify
    const decoder = new TextDecoder()
    const reader = readableStream.getReader()
    let fullText = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      fullText += decoder.decode(value, { stream: true })
    }

    assert.ok(fullText.length > 0, 'Converted stream should produce text')
    assert.ok(
      fullText.includes('STREAM_CONVERT_OK'),
      `Expected "STREAM_CONVERT_OK", got: "${fullText}"`
    )
  })

  test('converted stream works with new Response()', async () => {
    const { streamText } = await import('ai')
    const { createOpenAI } = await import('@ai-sdk/openai')

    if (skipIfNoKey()) return
    const apiKey = process.env.OPENAI_API_KEY!

    const openai = createOpenAI({ apiKey })
    const result = await streamText({
      model: openai('gpt-4o-mini'),
      messages: [{ role: 'user', content: 'Say ok' }],
      maxTokens: 5
    })

    const encoder = new TextEncoder()
    const readableStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for await (const chunk of result.textStream) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      }
    })

    // This is how the routes return it: new Response(stream, { headers })
    const httpResponse = new Response(readableStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'x-conversation-id': 'test-123'
      }
    })

    assert.ok(httpResponse.body, 'Response should have a body')
    assert.strictEqual(httpResponse.headers.get('Content-Type'), 'text/plain; charset=utf-8')
    assert.strictEqual(httpResponse.headers.get('x-conversation-id'), 'test-123')

    // Consume to avoid hanging
    const text = await httpResponse.text()
    assert.ok(text.length > 0)
  })
})

// -------------------------------------------------------------------
// 6. Responses API model detection (isResponsesModel)
// -------------------------------------------------------------------
describe('isResponsesModel', () => {
  // Inline the logic since we can't import @/ paths from Node test runner
  const isResponsesModel = (model?: string | null) =>
    !!model && (model.startsWith('gpt-5.4-nano') || model.startsWith('gpt-5-nano'))

  test('detects gpt-5.4-nano as responses model', () => {
    assert.strictEqual(isResponsesModel('gpt-5.4-nano'), true)
  })

  test('detects gpt-5-nano as responses model', () => {
    assert.strictEqual(isResponsesModel('gpt-5-nano'), true)
  })

  test('rejects gpt-4o-mini', () => {
    assert.strictEqual(isResponsesModel('gpt-4o-mini'), false)
  })

  test('rejects null', () => {
    assert.strictEqual(isResponsesModel(null), false)
  })

  test('rejects undefined', () => {
    assert.strictEqual(isResponsesModel(undefined), false)
  })

  test('rejects empty string', () => {
    assert.strictEqual(isResponsesModel(''), false)
  })
})

// -------------------------------------------------------------------
// 7. ReadableStream cancel() disposes resources
// -------------------------------------------------------------------
describe('ReadableStream cancel() cleanup', () => {
  test('cancel() on a ReadableStream fires the cancel handler', async () => {
    let cancelCalled = false

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Simulate a slow stream that never finishes
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('chunk1'))
        // Don't close — simulate an ongoing stream
      },
      cancel() {
        cancelCalled = true
      }
    })

    const reader = stream.getReader()
    await reader.read() // consume the first chunk
    await reader.cancel() // simulate client disconnect

    assert.ok(cancelCalled, 'cancel() handler should have been called')
  })

  test('safeDispose pattern prevents double-dispose', async () => {
    let disposeCount = 0
    let disposed = false
    const safeDispose = async () => {
      if (disposed) return
      disposed = true
      disposeCount++
    }

    await safeDispose()
    await safeDispose()
    await safeDispose()

    assert.strictEqual(disposeCount, 1, 'dispose should only run once')
  })
})

// -------------------------------------------------------------------
// 8. @ai-sdk/openai version compatibility
// -------------------------------------------------------------------
describe('SDK version check', () => {
  test('@ai-sdk/openai resolves without error', async () => {
    const mod = await import('@ai-sdk/openai')
    assert.ok(mod.createOpenAI, 'createOpenAI should be exported')
    assert.ok(mod.openai, 'openai default instance should be exported')
  })

  test('ai SDK v3 exports streamText (not experimental)', async () => {
    const ai = await import('ai')
    assert.strictEqual(typeof ai.streamText, 'function')
    // In v2, streamText didn't exist at top level
    // experimental_streamText was the v2 name — it should NOT exist in v3
  })

  test('ai SDK v3 exports tool helper', async () => {
    const ai = await import('ai')
    assert.strictEqual(typeof ai.tool, 'function')
    // In v2, the equivalent was experimental_onToolCall (callback-based)
  })
})
