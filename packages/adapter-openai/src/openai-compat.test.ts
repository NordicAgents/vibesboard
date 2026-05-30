/**
 * Tests for openai-compat.ts — the chat-completions / embeddings fetch shims.
 *
 * Covers request mapping (endpoint, headers, body), default values, response
 * passthrough, and error handling. fetch is mocked via the
 * `globalThis.fetch = ...` try/finally pattern.
 */
import { describe, it, expect } from 'vitest'

import {
  chatCompletion,
  createEmbedding,
  chatCompletionWithVision,
} from './openai-compat.ts'

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

/** Ensure OPENAI_API_KEY is set during the callback, then restore. */
async function withApiKey(key: string, fn: () => Promise<void>): Promise<void> {
  const prev = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = key
  try {
    await fn()
  } finally {
    if (prev === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = prev
  }
}

/** Ensure OPENAI_API_KEY is absent during the callback, then restore. */
async function withoutApiKey(fn: () => Promise<void>): Promise<void> {
  const prev = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY
  try {
    await fn()
  } finally {
    if (prev === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = prev
  }
}

// ---------------------------------------------------------------------------
// chatCompletion
// ---------------------------------------------------------------------------
describe('chatCompletion', () => {
  it('maps params to the chat/completions request and returns parsed JSON', async () => {
    let capturedUrl: any
    let capturedInit: any
    const apiResponse = {
      choices: [{ message: { content: 'hi there' } }],
    }

    await withApiKey('sk-chat-key', async () => {
      await withMockFetch(
        async (url: any, init: any) => {
          capturedUrl = url
          capturedInit = init
          return jsonResponse(apiResponse)
        },
        async () => {
          const result = await chatCompletion({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'hi' }],
            temperature: 0.7,
            max_tokens: 256,
          })
          expect(result).toEqual(apiResponse)
        }
      )
    })

    expect(capturedUrl).toBe('https://api.openai.com/v1/chat/completions')
    expect(capturedInit.method).toBe('POST')
    expect(capturedInit.headers.Authorization).toBe('Bearer sk-chat-key')
    expect(capturedInit.headers['Content-Type']).toBe('application/json')

    const body = JSON.parse(capturedInit.body)
    expect(body.model).toBe('gpt-4o')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(body.temperature).toBe(0.7)
    expect(body.max_tokens).toBe(256)
    expect(body.stream).toBe(false)
  })

  it('defaults temperature to 0.2 and leaves max_tokens undefined when omitted', async () => {
    let capturedInit: any
    await withApiKey('sk-chat-key', async () => {
      await withMockFetch(
        async (_url: any, init: any) => {
          capturedInit = init
          return jsonResponse({ choices: [] })
        },
        async () => {
          await chatCompletion({
            model: 'gpt-4o',
            messages: [{ role: 'system', content: 'be brief' }],
          })
        }
      )
    })

    const body = JSON.parse(capturedInit.body)
    expect(body.temperature).toBe(0.2)
    expect(body.max_tokens).toBeUndefined()
  })

  it('preserves a temperature of 0 (does not fall back to 0.2)', async () => {
    let capturedInit: any
    await withApiKey('sk-chat-key', async () => {
      await withMockFetch(
        async (_url: any, init: any) => {
          capturedInit = init
          return jsonResponse({ choices: [] })
        },
        async () => {
          await chatCompletion({
            model: 'gpt-4o',
            messages: [],
            temperature: 0,
          })
        }
      )
    })

    const body = JSON.parse(capturedInit.body)
    expect(body.temperature).toBe(0)
  })

  it('throws an error with status and body text on a non-ok response', async () => {
    await withApiKey('sk-chat-key', async () => {
      await withMockFetch(
        async () =>
          new Response('bad request details', {
            status: 400,
            headers: { 'Content-Type': 'text/plain' },
          }),
        async () => {
          await expect(
            chatCompletion({ model: 'gpt-4o', messages: [] })
          ).rejects.toThrow(/OpenAI chat completion error \(400\): bad request details/)
        }
      )
    })
  })

  it('throws when OPENAI_API_KEY is not configured', async () => {
    let called = false
    await withoutApiKey(async () => {
      await withMockFetch(
        async () => {
          called = true
          return jsonResponse({})
        },
        async () => {
          await expect(
            chatCompletion({ model: 'gpt-4o', messages: [] })
          ).rejects.toThrow(/OPENAI_API_KEY is not configured/)
        }
      )
    })
    expect(called).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createEmbedding
// ---------------------------------------------------------------------------
describe('createEmbedding', () => {
  it('maps params to the embeddings request and returns parsed JSON (string input)', async () => {
    let capturedUrl: any
    let capturedInit: any
    const apiResponse = {
      data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
    }

    await withApiKey('sk-embed-key', async () => {
      await withMockFetch(
        async (url: any, init: any) => {
          capturedUrl = url
          capturedInit = init
          return jsonResponse(apiResponse)
        },
        async () => {
          const result = await createEmbedding({
            model: 'text-embedding-3-small',
            input: 'hello',
          })
          expect(result).toEqual(apiResponse)
        }
      )
    })

    expect(capturedUrl).toBe('https://api.openai.com/v1/embeddings')
    expect(capturedInit.method).toBe('POST')
    expect(capturedInit.headers.Authorization).toBe('Bearer sk-embed-key')

    const body = JSON.parse(capturedInit.body)
    expect(body.model).toBe('text-embedding-3-small')
    expect(body.input).toBe('hello')
  })

  it('passes through an array input unchanged', async () => {
    let capturedInit: any
    await withApiKey('sk-embed-key', async () => {
      await withMockFetch(
        async (_url: any, init: any) => {
          capturedInit = init
          return jsonResponse({ data: [] })
        },
        async () => {
          await createEmbedding({
            model: 'text-embedding-3-small',
            input: ['a', 'b'],
          })
        }
      )
    })

    const body = JSON.parse(capturedInit.body)
    expect(body.input).toEqual(['a', 'b'])
  })

  it('throws an error with status and body text on a non-ok response', async () => {
    await withApiKey('sk-embed-key', async () => {
      await withMockFetch(
        async () =>
          new Response('quota exceeded', {
            status: 429,
            headers: { 'Content-Type': 'text/plain' },
          }),
        async () => {
          await expect(
            createEmbedding({ model: 'text-embedding-3-small', input: 'x' })
          ).rejects.toThrow(/OpenAI embedding error \(429\): quota exceeded/)
        }
      )
    })
  })

  it('throws when OPENAI_API_KEY is not configured', async () => {
    await withoutApiKey(async () => {
      await withMockFetch(
        async () => jsonResponse({}),
        async () => {
          await expect(
            createEmbedding({ model: 'text-embedding-3-small', input: 'x' })
          ).rejects.toThrow(/OPENAI_API_KEY is not configured/)
        }
      )
    })
  })
})

// ---------------------------------------------------------------------------
// chatCompletionWithVision
// ---------------------------------------------------------------------------
describe('chatCompletionWithVision', () => {
  it('maps params and defaults max_tokens to 300', async () => {
    let capturedUrl: any
    let capturedInit: any
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe' },
          { type: 'image_url', image_url: { url: 'https://x/y.png' } },
        ],
      },
    ]

    await withApiKey('sk-vision-key', async () => {
      await withMockFetch(
        async (url: any, init: any) => {
          capturedUrl = url
          capturedInit = init
          return jsonResponse({ choices: [{ message: { content: 'a cat' } }] })
        },
        async () => {
          const result = await chatCompletionWithVision({
            model: 'gpt-4o',
            messages,
          })
          expect(result.choices[0].message.content).toBe('a cat')
        }
      )
    })

    expect(capturedUrl).toBe('https://api.openai.com/v1/chat/completions')
    const body = JSON.parse(capturedInit.body)
    expect(body.model).toBe('gpt-4o')
    expect(body.messages).toEqual(messages)
    expect(body.max_tokens).toBe(300)
    expect(body.stream).toBe(false)
  })

  it('honors an explicit max_tokens override', async () => {
    let capturedInit: any
    await withApiKey('sk-vision-key', async () => {
      await withMockFetch(
        async (_url: any, init: any) => {
          capturedInit = init
          return jsonResponse({ choices: [] })
        },
        async () => {
          await chatCompletionWithVision({
            model: 'gpt-4o',
            messages: [],
            max_tokens: 1000,
          })
        }
      )
    })

    const body = JSON.parse(capturedInit.body)
    expect(body.max_tokens).toBe(1000)
  })

  it('throws an error with status and body text on a non-ok response', async () => {
    await withApiKey('sk-vision-key', async () => {
      await withMockFetch(
        async () =>
          new Response('vision failed', {
            status: 500,
            headers: { 'Content-Type': 'text/plain' },
          }),
        async () => {
          await expect(
            chatCompletionWithVision({ model: 'gpt-4o', messages: [] })
          ).rejects.toThrow(/OpenAI vision completion error \(500\): vision failed/)
        }
      )
    })
  })

  it('throws when OPENAI_API_KEY is not configured', async () => {
    await withoutApiKey(async () => {
      await withMockFetch(
        async () => jsonResponse({}),
        async () => {
          await expect(
            chatCompletionWithVision({ model: 'gpt-4o', messages: [] })
          ).rejects.toThrow(/OPENAI_API_KEY is not configured/)
        }
      )
    })
  })
})
