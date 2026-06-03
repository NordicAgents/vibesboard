/**
 * Tests for openai.ts — token usage extraction from the Responses API,
 * model defaults / gating, error handling, and SSE streaming.
 *
 * Migrated from node:test to Vitest. fetch is mocked via the
 * `globalThis.fetch = ...` try/finally pattern, preserving the original intent.
 */
import { describe, it, expect } from 'vitest'

import {
  completeText,
  streamText,
  isResponsesModel,
  OPENAI_MODEL,
  OPENAI_CHAT_MODEL,
  OPENAI_VISION_MODEL,
  type ResponsesApiTool,
} from './openai.ts'

// ---------------------------------------------------------------------------
// Helper: build a mock Responses API JSON body
// ---------------------------------------------------------------------------
function buildResponseJson({
  text = 'Hello',
  toolCalls = [] as any[],
  inputTokens = 100,
  outputTokens = 50,
}: {
  text?: string
  toolCalls?: any[]
  inputTokens?: number
  outputTokens?: number
} = {}) {
  const output: any[] = []

  if (text) {
    output.push({
      type: 'message',
      content: [{ type: 'output_text', text }],
    })
  }

  for (const tc of toolCalls) {
    output.push({
      type: 'function_call',
      name: tc.name,
      arguments: JSON.stringify(tc.arguments ?? {}),
      call_id: tc.callId ?? 'call_1',
    })
  }

  return {
    output,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  }
}

// ---------------------------------------------------------------------------
// Helper: build a mock SSE stream from events
// ---------------------------------------------------------------------------
function buildSseStream(
  events: Array<{ type: string; data: any }>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const chunks = events.map((e) => `data: ${JSON.stringify(e.data)}\n\n`)

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

/** Drain a stream into a single decoded string. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) output += decoder.decode(value, { stream: true })
  }
  return output
}

/** Mock globalThis.fetch for the duration of `fn`, restoring it afterwards. */
async function withMockFetch(
  impl: (input: any, init?: any) => Promise<Response> | Response,
  fn: () => Promise<void>
): Promise<void> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = impl as typeof fetch
  try {
    await fn()
  } finally {
    globalThis.fetch = originalFetch
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// model defaults / gating
// ---------------------------------------------------------------------------
describe('model defaults', () => {
  it('exposes gpt-5.4-nano defaults', () => {
    expect(OPENAI_MODEL).toBe('gpt-5.4-nano')
    expect(OPENAI_CHAT_MODEL).toBe('gpt-5.4-nano')
    expect(OPENAI_VISION_MODEL).toBe('gpt-5.4-nano')
  })
})

describe('isResponsesModel', () => {
  it('accepts gpt-5.4-nano and gpt-5-nano prefixes', () => {
    expect(isResponsesModel('gpt-5.4-nano')).toBe(true)
    expect(isResponsesModel('gpt-5.4-nano-2025')).toBe(true)
    expect(isResponsesModel('gpt-5-nano')).toBe(true)
    expect(isResponsesModel('gpt-5-nano-mini')).toBe(true)
  })

  it('rejects non-responses, empty, null, and undefined models', () => {
    expect(isResponsesModel('gpt-4o')).toBe(false)
    expect(isResponsesModel('gpt-5')).toBe(false)
    expect(isResponsesModel('')).toBe(false)
    expect(isResponsesModel(null)).toBe(false)
    expect(isResponsesModel(undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// completeText — token extraction
// ---------------------------------------------------------------------------
describe('completeText token extraction', () => {
  it('extracts usage from successful response', async () => {
    const responseBody = buildResponseJson({
      text: 'Hello world',
      inputTokens: 150,
      outputTokens: 42,
    })

    await withMockFetch(
      async () => jsonResponse(responseBody),
      async () => {
        const result = await completeText({
          prompt: 'Say hello',
          model: 'gpt-5.4-nano',
          apiKey: 'sk-test-key',
        })

        expect(result.text).toBe('Hello world')
        expect(result.usage).toBeTruthy()
        expect(result.usage!.inputTokens).toBe(150)
        expect(result.usage!.outputTokens).toBe(42)
        expect(result.toolCalls).toEqual([])
      }
    )
  })

  it('extracts usage alongside tool calls', async () => {
    const responseBody = buildResponseJson({
      text: '',
      toolCalls: [
        { name: 'search', arguments: { query: 'test' }, callId: 'call_abc' },
      ],
      inputTokens: 200,
      outputTokens: 30,
    })

    await withMockFetch(
      async () => jsonResponse(responseBody),
      async () => {
        const result = await completeText({
          prompt: 'Search for something',
          model: 'gpt-5.4-nano',
          apiKey: 'sk-test-key',
        })

        expect(result.toolCalls.length).toBe(1)
        expect(result.toolCalls[0].name).toBe('search')
        expect(result.toolCalls[0].arguments).toEqual({ query: 'test' })
        expect(result.toolCalls[0].callId).toBe('call_abc')
        expect(result.usage).toBeTruthy()
        expect(result.usage!.inputTokens).toBe(200)
        expect(result.usage!.outputTokens).toBe(30)
      }
    )
  })

  it('returns undefined usage when API omits usage field', async () => {
    const responseBody = {
      output: [
        { type: 'message', content: [{ type: 'output_text', text: 'Hi' }] },
      ],
      // no usage field
    }

    await withMockFetch(
      async () => jsonResponse(responseBody),
      async () => {
        const result = await completeText({
          prompt: 'Hi',
          model: 'gpt-5.4-nano',
          apiKey: 'sk-test-key',
        })

        expect(result.text).toBe('Hi')
        expect(result.usage).toBeUndefined()
      }
    )
  })

  it('defaults missing token counts to 0 when usage object is present but empty', async () => {
    await withMockFetch(
      async () => jsonResponse({ output: [], usage: {} }),
      async () => {
        const result = await completeText({
          prompt: 'Hi',
          model: 'gpt-5.4-nano',
          apiKey: 'sk-test-key',
        })

        expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
      }
    )
  })

  it('returns empty result when output is not an array', async () => {
    await withMockFetch(
      async () => jsonResponse({ output: null, usage: undefined }),
      async () => {
        const result = await completeText({
          prompt: 'Hi',
          model: 'gpt-5.4-nano',
          apiKey: 'sk-test-key',
        })

        expect(result.text).toBe('')
        expect(result.toolCalls).toEqual([])
        expect(result.usage).toBeUndefined()
      }
    )
  })

  it('falls back to {} arguments when tool call arguments are invalid JSON', async () => {
    const responseBody = {
      output: [
        {
          type: 'function_call',
          name: 'broken',
          arguments: '{not-json',
          call_id: 'call_x',
        },
      ],
      usage: { input_tokens: 1, output_tokens: 2 },
    }

    await withMockFetch(
      async () => jsonResponse(responseBody),
      async () => {
        const result = await completeText({
          prompt: 'tool',
          model: 'gpt-5.4-nano',
          apiKey: 'sk-test-key',
        })

        expect(result.toolCalls.length).toBe(1)
        expect(result.toolCalls[0].arguments).toEqual({})
        expect(result.toolCalls[0].callId).toBe('call_x')
      }
    )
  })

  it('handles object-form tool arguments and missing call_id', async () => {
    const responseBody = {
      output: [
        {
          type: 'function_call',
          name: 'obj',
          arguments: { a: 1 },
          // no call_id
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    }

    await withMockFetch(
      async () => jsonResponse(responseBody),
      async () => {
        const result = await completeText({
          prompt: 'tool',
          model: 'gpt-5.4-nano',
          apiKey: 'sk-test-key',
        })

        expect(result.toolCalls[0].arguments).toEqual({ a: 1 })
        expect(result.toolCalls[0].callId).toBe('')
      }
    )
  })

  it('extracts text from the nested {value} output_text shape', async () => {
    const responseBody = {
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: { value: 'nested text' } }],
        },
      ],
      usage: { input_tokens: 5, output_tokens: 5 },
    }

    await withMockFetch(
      async () => jsonResponse(responseBody),
      async () => {
        const result = await completeText({
          prompt: 'Hi',
          model: 'gpt-5.4-nano',
          apiKey: 'sk-test-key',
        })

        expect(result.text).toBe('nested text')
      }
    )
  })

  it('sends tools in the request body and targets the responses endpoint', async () => {
    const tools: ResponsesApiTool[] = [
      {
        type: 'function',
        name: 'lookup',
        description: 'Look something up',
        parameters: { type: 'object', properties: {} },
      },
    ]
    let capturedUrl: any
    let capturedInit: any

    await withMockFetch(
      async (url: any, init: any) => {
        capturedUrl = url
        capturedInit = init
        return jsonResponse(buildResponseJson({ text: 'ok' }))
      },
      async () => {
        await completeText({
          prompt: 'use tool',
          model: 'gpt-5.4-nano',
          apiKey: 'sk-test-key',
          tools,
        })
      }
    )

    expect(capturedUrl).toBe('https://api.openai.com/v1/responses')
    expect(capturedInit.method).toBe('POST')
    expect(capturedInit.headers.Authorization).toBe('Bearer sk-test-key')
    const body = JSON.parse(capturedInit.body)
    expect(body.model).toBe('gpt-5.4-nano')
    expect(body.input).toBe('use tool')
    expect(body.tools).toEqual(tools)
  })

  it('omits tools from the request body when none are provided', async () => {
    let capturedInit: any
    await withMockFetch(
      async (_url: any, init: any) => {
        capturedInit = init
        return jsonResponse(buildResponseJson({ text: 'ok' }))
      },
      async () => {
        await completeText({
          prompt: 'no tools',
          model: 'gpt-5.4-nano',
          apiKey: 'sk-test-key',
        })
      }
    )

    const body = JSON.parse(capturedInit.body)
    expect('tools' in body).toBe(false)
  })

  it('falls back to OPENAI_API_KEY env var when apiKey is not passed', async () => {
    const prev = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'sk-env-key'
    let capturedInit: any
    try {
      await withMockFetch(
        async (_url: any, init: any) => {
          capturedInit = init
          return jsonResponse(buildResponseJson({ text: 'ok' }))
        },
        async () => {
          await completeText({ prompt: 'hi', model: 'gpt-5.4-nano' })
        }
      )
      expect(capturedInit.headers.Authorization).toBe('Bearer sk-env-key')
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = prev
    }
  })
})

// ---------------------------------------------------------------------------
// completeText — error handling / gating
// ---------------------------------------------------------------------------
describe('completeText error handling', () => {
  it('rejects non-responses models without calling fetch', async () => {
    let called = false
    await withMockFetch(
      async () => {
        called = true
        return jsonResponse({})
      },
      async () => {
        await expect(
          completeText({
            prompt: 'hi',
            model: 'gpt-4o',
            apiKey: 'sk-test-key',
          })
        ).rejects.toThrow(/responses-only models/)
      }
    )
    expect(called).toBe(false)
  })

  it('falls back to OPENAI_MODEL when model is null and gating passes', async () => {
    await withMockFetch(
      async () => jsonResponse(buildResponseJson({ text: 'ok' })),
      async () => {
        const result = await completeText({
          prompt: 'hi',
          model: null,
          apiKey: 'sk-test-key',
        })
        expect(result.text).toBe('ok')
      }
    )
  })

  it('throws when OPENAI_API_KEY is missing and no apiKey passed', async () => {
    const prev = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    let called = false
    try {
      await withMockFetch(
        async () => {
          called = true
          return jsonResponse({})
        },
        async () => {
          await expect(
            completeText({ prompt: 'hi', model: 'gpt-5.4-nano' })
          ).rejects.toThrow(/OPENAI_API_KEY is not configured/)
        }
      )
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = prev
    }
    expect(called).toBe(false)
  })

  it('throws a Responses API error including the status code on non-ok', async () => {
    await withMockFetch(
      async () =>
        new Response('rate limited', {
          status: 429,
          headers: { 'Content-Type': 'text/plain' },
        }),
      async () => {
        await expect(
          completeText({
            prompt: 'hi',
            model: 'gpt-5.4-nano',
            apiKey: 'sk-test-key',
          })
        ).rejects.toThrow(/Responses API error \(429\)/)
      }
    )
  })
})

// ---------------------------------------------------------------------------
// streamText — SSE usage extraction
// ---------------------------------------------------------------------------
describe('streamText token extraction from SSE', () => {
  it('captures usage from response.completed event', async () => {
    let capturedUsage: any = undefined
    let capturedFull = ''

    const sseEvents = [
      {
        type: 'delta',
        data: { type: 'response.output_text.delta', delta: 'Hello' },
      },
      {
        type: 'delta',
        data: { type: 'response.output_text.delta', delta: ' world' },
      },
      {
        type: 'completed',
        data: {
          type: 'response.completed',
          response: {
            usage: { input_tokens: 300, output_tokens: 75 },
          },
        },
      },
    ]

    await withMockFetch(
      async () =>
        new Response(buildSseStream(sseEvents), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      async () => {
        const stream = await streamText({
          prompt: 'Say hello world',
          model: 'gpt-5.4-nano',
          apiKey: 'sk-test-key',
          onDone(full, usage) {
            capturedFull = full
            capturedUsage = usage
          },
        })

        const output = await drain(stream)

        expect(output).toBe('Hello world')
        expect(capturedFull).toBe('Hello world')
        expect(capturedUsage).toBeTruthy()
        expect(capturedUsage.inputTokens).toBe(300)
        expect(capturedUsage.outputTokens).toBe(75)
      }
    )
  })

  it('passes undefined usage when response.completed has no usage', async () => {
    let capturedUsage: any = 'not-called'

    const sseEvents = [
      {
        type: 'delta',
        data: { type: 'response.output_text.delta', delta: 'Hi' },
      },
      // no response.completed event
    ]

    await withMockFetch(
      async () =>
        new Response(buildSseStream(sseEvents), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      async () => {
        const stream = await streamText({
          prompt: 'Hi',
          model: 'gpt-5.4-nano',
          apiKey: 'sk-test-key',
          onDone(_full, usage) {
            capturedUsage = usage
          },
        })

        await drain(stream)

        expect(capturedUsage).toBeUndefined()
      }
    )
  })

  it('invokes onToken for each delta', async () => {
    const tokens: string[] = []
    const sseEvents = [
      { type: 'd', data: { type: 'response.output_text.delta', delta: 'a' } },
      { type: 'd', data: { type: 'response.output_text.delta', delta: 'b' } },
      { type: 'd', data: { type: 'response.output_text.delta', delta: 'c' } },
    ]

    await withMockFetch(
      async () =>
        new Response(buildSseStream(sseEvents), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      async () => {
        const stream = await streamText({
          prompt: 'abc',
          model: 'gpt-5.4-nano',
          apiKey: 'sk-test-key',
          onToken(delta) {
            tokens.push(delta)
          },
        })
        const output = await drain(stream)
        expect(output).toBe('abc')
        expect(tokens).toEqual(['a', 'b', 'c'])
      }
    )
  })

  it('ignores non-delta event types and malformed data lines', async () => {
    // Manually craft a body with an unknown event, a malformed JSON data line,
    // and a valid delta — only the valid delta should surface.
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"type":"response.created"}\n\n')
        )
        controller.enqueue(encoder.encode('data: {not json}\n\n'))
        controller.enqueue(
          encoder.encode(
            'data: {"type":"response.output_text.delta","delta":"ok"}\n\n'
          )
        )
        controller.close()
      },
    })

    await withMockFetch(
      async () =>
        new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      async () => {
        const stream = await streamText({
          prompt: 'x',
          model: 'gpt-5.4-nano',
          apiKey: 'sk-test-key',
        })
        const output = await drain(stream)
        expect(output).toBe('ok')
      }
    )
  })

  it('rejects non-responses models for streamText', async () => {
    await expect(
      streamText({
        prompt: 'x',
        model: 'gpt-4o',
        apiKey: 'sk-test-key',
      })
    ).rejects.toThrow(/responses-only models/)
  })

  it('throws when OPENAI_API_KEY is missing for streamText', async () => {
    const prev = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    try {
      await expect(
        streamText({ prompt: 'x', model: 'gpt-5.4-nano' })
      ).rejects.toThrow(/OPENAI_API_KEY is not configured/)
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = prev
    }
  })

  it('throws a stream error including the status code when response is not ok', async () => {
    await withMockFetch(
      async () =>
        new Response('boom', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        }),
      async () => {
        await expect(
          streamText({
            prompt: 'x',
            model: 'gpt-5.4-nano',
            apiKey: 'sk-test-key',
          })
        ).rejects.toThrow(/Responses API stream error \(500\)/)
      }
    )
  })

  it('throws a stream error when the response has no body', async () => {
    await withMockFetch(
      async () => new Response(null, { status: 200 }),
      async () => {
        await expect(
          streamText({
            prompt: 'x',
            model: 'gpt-5.4-nano',
            apiKey: 'sk-test-key',
          })
        ).rejects.toThrow(/Responses API stream error/)
      }
    )
  })

  it('sets stream:true in the request body', async () => {
    let capturedInit: any
    await withMockFetch(
      async (_url: any, init: any) => {
        capturedInit = init
        return new Response(buildSseStream([]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      },
      async () => {
        const stream = await streamText({
          prompt: 'x',
          model: 'gpt-5.4-nano',
          apiKey: 'sk-test-key',
        })
        await drain(stream)
      }
    )
    const body = JSON.parse(capturedInit.body)
    expect(body.stream).toBe(true)
    expect(body.input).toBe('x')
  })
})
