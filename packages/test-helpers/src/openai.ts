// Deterministic OpenAI network stub.
//
// The OpenAI adapter (packages/adapter-openai) and the Vercel AI SDK both
// ultimately call `globalThis.fetch`. These helpers swap fetch for a canned
// implementation so tests are deterministic, offline, and free. Pair every
// stubOpenAIFetch() with restoreFetch() (e.g. in afterEach).

type FetchFn = typeof globalThis.fetch

let saved: FetchFn | null = null

export interface OpenAIStubOptions {
  /** Text returned as the assistant message / output_text. */
  text?: string
  /** Prompt (input) token count reported in usage. */
  inputTokens?: number
  /** Completion (output) token count reported in usage. */
  outputTokens?: number
  /** Embedding vector returned for embeddings requests. */
  embedding?: number[]
  /** Optional override invoked with (url, init); return a Response to bypass canned bodies. */
  handler?: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Replace globalThis.fetch with a deterministic OpenAI stub.
 * Returns the previous fetch so callers can restore manually if preferred.
 */
export function stubOpenAIFetch(opts: OpenAIStubOptions = {}): FetchFn {
  const {
    text = 'stubbed completion',
    inputTokens = 10,
    outputTokens = 5,
    embedding = new Array(1536).fill(0).map((_, i) => (i % 7) / 7),
    handler,
  } = opts

  if (saved === null) saved = globalThis.fetch

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const custom = handler?.(url, init)
    if (custom) return custom

    // Embeddings endpoint
    if (url.includes('/embeddings')) {
      return json({
        object: 'list',
        data: [{ object: 'embedding', index: 0, embedding }],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: inputTokens, total_tokens: inputTokens },
      })
    }

    // Responses API
    if (url.includes('/responses')) {
      return json({
        id: 'resp_stub',
        object: 'response',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text }],
          },
        ],
        output_text: text,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
        },
      })
    }

    // Chat completions (legacy compat shim)
    if (url.includes('/chat/completions')) {
      return json({
        id: 'chatcmpl_stub',
        object: 'chat.completion',
        choices: [
          { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' },
        ],
        usage: {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
        },
      })
    }

    // Anything else: empty 200 so callers don't hit the network.
    return json({})
  }) as FetchFn

  return saved
}

/** Restore the real fetch saved by the first stubOpenAIFetch() call. */
export function restoreFetch(): void {
  if (saved !== null) {
    globalThis.fetch = saved
    saved = null
  }
}
