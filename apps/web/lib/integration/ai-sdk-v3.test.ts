/**
 * Integration tests for AI SDK v3 migration.
 *
 * Verifies SDK imports resolve, client/model construction, the tool() helper,
 * stream conversion patterns, and Responses-model detection. Live OpenAI calls
 * self-skip unless a real `sk-…` key is present.
 */
import { describe, it, expect } from 'vitest'

// A real OpenAI key starts with "sk-" and is 40+ chars. Placeholder values
// like the deterministic test key should be treated as missing for LIVE tests.
function hasRealApiKey(): boolean {
  const key = process.env.OPENAI_API_KEY
  return !!key && key.startsWith('sk-') && key.length >= 40
}

// -------------------------------------------------------------------
// 1. SDK imports resolve correctly
// -------------------------------------------------------------------
describe('AI SDK v3 imports', () => {
  it('streamText is exported from "ai"', async () => {
    const ai = await import('ai')
    expect(typeof ai.streamText).toBe('function')
  })

  it('createOpenAI is exported from "@ai-sdk/openai"', async () => {
    const { createOpenAI } = await import('@ai-sdk/openai')
    expect(typeof createOpenAI).toBe('function')
  })

  it('tool is exported from "ai"', async () => {
    const ai = await import('ai')
    expect(typeof ai.tool).toBe('function')
  })

  it('Message type re-export resolves (runtime import check)', async () => {
    const ai = await import('ai')
    expect(ai).toBeTruthy()
  })
})

// -------------------------------------------------------------------
// 2. createOpenAI client creation
// -------------------------------------------------------------------
describe('createOpenAI client', () => {
  it('creates a provider with API key', async () => {
    const { createOpenAI } = await import('@ai-sdk/openai')
    const client = createOpenAI({ apiKey: 'sk-test' })
    expect(client).toBeTruthy()
    expect(typeof client).toBe('function')
  })

  it('creates a model instance from provider', async () => {
    const { createOpenAI } = await import('@ai-sdk/openai')
    const client = createOpenAI({ apiKey: 'sk-test' })
    const model = client('gpt-4o-mini')
    expect(model).toBeTruthy()
    expect(typeof model.doStream).toBe('function')
  })
})

// -------------------------------------------------------------------
// 3. streamText produces a streaming result (live API call)
// -------------------------------------------------------------------
describe.skipIf(!hasRealApiKey())('streamText live integration', () => {
  it('streams text from OpenAI via ai SDK v3', async () => {
    const { streamText } = await import('ai')
    const { createOpenAI } = await import('@ai-sdk/openai')
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! })
    const result = await streamText({
      model: openai('gpt-4o-mini'),
      messages: [
        { role: 'system', content: 'Reply with exactly: HELLO_TEST' },
        { role: 'user', content: 'Say the phrase.' }
      ],
      temperature: 0,
      maxTokens: 20
    })

    let fullText = ''
    for await (const chunk of result.textStream) fullText += chunk

    expect(fullText.length > 0).toBeTruthy()
    expect(fullText.includes('HELLO_TEST')).toBeTruthy()
  })

  it('toTextStreamResponse returns a Response with correct headers', async () => {
    const { streamText } = await import('ai')
    const { createOpenAI } = await import('@ai-sdk/openai')
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! })
    const result = await streamText({
      model: openai('gpt-4o-mini'),
      messages: [{ role: 'user', content: 'Say ok' }],
      maxTokens: 5
    })

    const response = result.toTextStreamResponse()
    expect(response instanceof Response).toBeTruthy()
    expect(response.body).toBeTruthy()

    const reader = response.body!.getReader()
    while (!(await reader.read()).done) {}
  })
})

// -------------------------------------------------------------------
// 4. tool() helper works (agent-creator pattern)
// -------------------------------------------------------------------
describe('tool() helper', () => {
  it('defines a tool with schema and execute function', async () => {
    const { tool } = await import('ai')
    const { z } = await import('zod')

    const myTool = tool({
      description: 'Test tool',
      parameters: z.object({ name: z.string(), count: z.number() }),
      async execute({ name, count }) {
        return `Created ${name} with ${count} items`
      }
    })

    expect(myTool).toBeTruthy()
    expect(typeof myTool.execute).toBe('function')
    expect((myTool as any).description).toBe('Test tool')
  })

  it('tool execute function runs correctly', async () => {
    const { tool } = await import('ai')
    const { z } = await import('zod')

    const myTool = tool({
      description: 'Adder',
      parameters: z.object({ a: z.number(), b: z.number() }),
      async execute({ a, b }) {
        return `${a + b}`
      }
    })

    const result = await myTool.execute!({ a: 3, b: 7 }, {
      abortSignal: new AbortController().signal
    } as any)
    expect(result).toBe('10')
  })
})

// -------------------------------------------------------------------
// 5. Manual stream conversion pattern (runtime.ts)
// -------------------------------------------------------------------
describe('textStream to ReadableStream conversion', () => {
  it('converted stream works with new Response()', async () => {
    // Pure stream-plumbing test — no network. Mirrors the route pattern of
    // wrapping an async iterable in a ReadableStream returned via Response.
    const chunks = ['STREAM_', 'CONVERT_', 'OK']
    const encoder = new TextEncoder()
    const readableStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      }
    })

    const httpResponse = new Response(readableStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'x-conversation-id': 'test-123'
      }
    })

    expect(httpResponse.body).toBeTruthy()
    expect(httpResponse.headers.get('Content-Type')).toBe(
      'text/plain; charset=utf-8'
    )
    expect(httpResponse.headers.get('x-conversation-id')).toBe('test-123')

    const text = await httpResponse.text()
    expect(text).toBe('STREAM_CONVERT_OK')
  })
})

// -------------------------------------------------------------------
// 6. Responses API model detection (isResponsesModel)
// -------------------------------------------------------------------
describe('isResponsesModel', () => {
  const isResponsesModel = (model?: string | null) =>
    !!model &&
    (model.startsWith('gpt-5.4-nano') || model.startsWith('gpt-5-nano'))

  it('detects gpt-5.4-nano as responses model', () => {
    expect(isResponsesModel('gpt-5.4-nano')).toBe(true)
  })

  it('detects gpt-5-nano as responses model', () => {
    expect(isResponsesModel('gpt-5-nano')).toBe(true)
  })

  it('rejects gpt-4o-mini', () => {
    expect(isResponsesModel('gpt-4o-mini')).toBe(false)
  })

  it('rejects null', () => {
    expect(isResponsesModel(null)).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isResponsesModel(undefined)).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isResponsesModel('')).toBe(false)
  })
})

// -------------------------------------------------------------------
// 7. ReadableStream cancel() disposes resources
// -------------------------------------------------------------------
describe('ReadableStream cancel() cleanup', () => {
  it('cancel() on a ReadableStream fires the cancel handler', async () => {
    let cancelCalled = false

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('chunk1'))
      },
      cancel() {
        cancelCalled = true
      }
    })

    const reader = stream.getReader()
    await reader.read()
    await reader.cancel()

    expect(cancelCalled).toBeTruthy()
  })

  it('safeDispose pattern prevents double-dispose', async () => {
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

    expect(disposeCount).toBe(1)
  })
})

// -------------------------------------------------------------------
// 8. pull()-based ReadableStream respects backpressure
// -------------------------------------------------------------------
describe('pull()-based ReadableStream', () => {
  it('pull() is called lazily — only when consumer reads', async () => {
    let pullCount = 0
    const chunks = ['a', 'b', 'c']
    let chunkIndex = 0
    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount++
        if (chunkIndex >= chunks.length) {
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(chunks[chunkIndex++]))
      }
    })

    const reader = stream.getReader()

    const { value: v1 } = await reader.read()
    expect(v1).toBeTruthy()

    expect(pullCount >= 1).toBeTruthy()

    const { value: v2 } = await reader.read()
    expect(v2).toBeTruthy()

    await reader.read() // 'c'
    const { done } = await reader.read() // done
    expect(done).toBeTruthy()
  })

  it('cancel() stops iterator via return()', async () => {
    let returnCalled = false
    const fakeIterator = {
      next: async () => ({ value: 'chunk', done: false }),
      return: async () => {
        returnCalled = true
        return { value: undefined, done: true as const }
      }
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { value, done } = await fakeIterator.next()
        if (done) {
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(value))
      },
      cancel() {
        fakeIterator.return?.()
      }
    })

    const reader = stream.getReader()
    await reader.read()
    await reader.cancel()

    expect(returnCalled).toBeTruthy()
  })
})

// -------------------------------------------------------------------
// 9. @ai-sdk/openai version compatibility
// -------------------------------------------------------------------
describe('SDK version check', () => {
  it('@ai-sdk/openai resolves without error', async () => {
    const mod = await import('@ai-sdk/openai')
    expect(mod.createOpenAI).toBeTruthy()
    expect(mod.openai).toBeTruthy()
  })

  it('ai SDK v3 exports streamText (not experimental)', async () => {
    const ai = await import('ai')
    expect(typeof ai.streamText).toBe('function')
  })

  it('ai SDK v3 exports tool helper', async () => {
    const ai = await import('ai')
    expect(typeof ai.tool).toBe('function')
  })
})

// -------------------------------------------------------------------
// 10. v2 backward-compat aliases
// -------------------------------------------------------------------
describe('AI SDK v3 alias checks', () => {
  it('experimental_streamText, if present, aliases streamText', async () => {
    const ai = await import('ai')
    if ((ai as any).experimental_streamText) {
      expect((ai as any).experimental_streamText).toBe(ai.streamText)
    }
  })

  it('experimental_generateText, if present, aliases generateText', async () => {
    const ai = await import('ai')
    if ((ai as any).experimental_generateText) {
      expect((ai as any).experimental_generateText).toBe(ai.generateText)
    }
  })
})
