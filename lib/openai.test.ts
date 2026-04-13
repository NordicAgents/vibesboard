/**
 * Tests for lib/openai.ts — token usage extraction from Responses API.
 *
 * Verifies that completeText() and streamText() correctly capture and
 * return input/output token counts from API responses.
 *
 * Run:
 *   node --experimental-strip-types --test lib/openai.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// ---------------------------------------------------------------------------
// Helper: build a mock Responses API JSON body
// ---------------------------------------------------------------------------
function buildResponseJson({
  text = 'Hello',
  toolCalls = [] as any[],
  inputTokens = 100,
  outputTokens = 50
} = {}) {
  const output: any[] = []

  if (text) {
    output.push({
      type: 'message',
      content: [{ type: 'output_text', text }]
    })
  }

  for (const tc of toolCalls) {
    output.push({
      type: 'function_call',
      name: tc.name,
      arguments: JSON.stringify(tc.arguments ?? {}),
      call_id: tc.callId ?? 'call_1'
    })
  }

  return {
    output,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: build a mock SSE stream from events
// ---------------------------------------------------------------------------
function buildSseStream(
  events: Array<{ type: string; data: any }>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const chunks = events.map(e => `data: ${JSON.stringify(e.data)}\n\n`)

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    }
  })
}

// ---------------------------------------------------------------------------
// completeText — token extraction
// ---------------------------------------------------------------------------
describe('completeText token extraction', () => {
  test('extracts usage from successful response', async () => {
    const responseBody = buildResponseJson({
      text: 'Hello world',
      inputTokens: 150,
      outputTokens: 42
    })

    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })

    try {
      const { completeText } = await import('./openai.ts')
      const result = await completeText({
        prompt: 'Say hello',
        model: 'gpt-5.4-nano',
        apiKey: 'sk-test-key'
      })

      assert.equal(result.text, 'Hello world')
      assert.ok(result.usage, 'usage should be defined')
      assert.equal(result.usage!.inputTokens, 150)
      assert.equal(result.usage!.outputTokens, 42)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('extracts usage alongside tool calls', async () => {
    const responseBody = buildResponseJson({
      text: '',
      toolCalls: [
        { name: 'search', arguments: { query: 'test' }, callId: 'call_abc' }
      ],
      inputTokens: 200,
      outputTokens: 30
    })

    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })

    try {
      const { completeText } = await import('./openai.ts')
      const result = await completeText({
        prompt: 'Search for something',
        model: 'gpt-5.4-nano',
        apiKey: 'sk-test-key'
      })

      assert.equal(result.toolCalls.length, 1)
      assert.equal(result.toolCalls[0].name, 'search')
      assert.ok(result.usage, 'usage should be defined')
      assert.equal(result.usage!.inputTokens, 200)
      assert.equal(result.usage!.outputTokens, 30)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('returns undefined usage when API omits usage field', async () => {
    const responseBody = {
      output: [
        { type: 'message', content: [{ type: 'output_text', text: 'Hi' }] }
      ]
      // no usage field
    }

    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })

    try {
      const { completeText } = await import('./openai.ts')
      const result = await completeText({
        prompt: 'Hi',
        model: 'gpt-5.4-nano',
        apiKey: 'sk-test-key'
      })

      assert.equal(result.text, 'Hi')
      assert.equal(result.usage, undefined)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

// ---------------------------------------------------------------------------
// streamText — SSE usage extraction
// ---------------------------------------------------------------------------
describe('streamText token extraction from SSE', () => {
  test('captures usage from response.completed event', async () => {
    let capturedUsage: any = undefined
    let capturedFull = ''

    const sseEvents = [
      {
        type: 'delta',
        data: { type: 'response.output_text.delta', delta: 'Hello' }
      },
      {
        type: 'delta',
        data: { type: 'response.output_text.delta', delta: ' world' }
      },
      {
        type: 'completed',
        data: {
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: 300,
              output_tokens: 75
            }
          }
        }
      }
    ]

    const sseBody = buildSseStream(sseEvents)

    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
      })

    try {
      const { streamText } = await import('./openai.ts')
      const stream = await streamText({
        prompt: 'Say hello world',
        model: 'gpt-5.4-nano',
        apiKey: 'sk-test-key',
        onDone(full, usage) {
          capturedFull = full
          capturedUsage = usage
        }
      })

      // Drain the stream to trigger onDone
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      let output = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        output += decoder.decode(value, { stream: true })
      }

      assert.equal(output, 'Hello world')
      assert.equal(capturedFull, 'Hello world')
      assert.ok(capturedUsage, 'onDone should receive usage')
      assert.equal(capturedUsage.inputTokens, 300)
      assert.equal(capturedUsage.outputTokens, 75)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('passes undefined usage when response.completed has no usage', async () => {
    let capturedUsage: any = 'not-called'

    const sseEvents = [
      {
        type: 'delta',
        data: { type: 'response.output_text.delta', delta: 'Hi' }
      }
      // no response.completed event
    ]

    const sseBody = buildSseStream(sseEvents)

    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
      })

    try {
      const { streamText } = await import('./openai.ts')
      const stream = await streamText({
        prompt: 'Hi',
        model: 'gpt-5.4-nano',
        apiKey: 'sk-test-key',
        onDone(_full, usage) {
          capturedUsage = usage
        }
      })

      // Drain
      const reader = stream.getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }

      assert.equal(
        capturedUsage,
        undefined,
        'usage should be undefined when no response.completed event'
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
