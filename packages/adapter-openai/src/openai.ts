const cleanEnv = (value?: string) => value?.trim()

const baseModel = cleanEnv(process.env.OPENAI_MODEL) ?? 'gpt-5.4-nano'

export const OPENAI_MODEL = baseModel
export const OPENAI_CHAT_MODEL = baseModel

// Vision-capable model can be overridden separately; defaults to a safe vision model.
export const OPENAI_VISION_MODEL =
  cleanEnv(process.env.OPENAI_VISION_MODEL) ?? 'gpt-5.4-nano'

// Embedding model used whenever we embed with the PLATFORM key. Overridable
// because the model name is provider-specific: OpenAI serves
// text-embedding-3-small, Gemini's gateway 404s on that name and wants
// gemini-embedding-001. Deliberately NOT applied to a tenant's own `openai`
// provider — that key talks to real OpenAI, so it keeps the OpenAI name.
export const PLATFORM_EMBEDDING_MODEL =
  cleanEnv(process.env.OPENAI_EMBEDDINGS_MODEL) ?? 'text-embedding-3-small'

// Requested output width for platform embeddings. Left undefined for OpenAI,
// whose text-embedding-3-small is natively 1536. Set it for any model whose
// native width is not a pgvector table width (384/768/1024/1536) —
// gemini-embedding-001 defaults to 3072 and must be pinned to 1536.
export const PLATFORM_EMBEDDING_DIMENSIONS = ((): number | undefined => {
  const raw = cleanEnv(process.env.OPENAI_EMBEDDINGS_DIMENSIONS)
  if (!raw) return undefined
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
})()

// Base URL for the OpenAI-compatible API. Defaults to the public OpenAI API,
// but can be overridden (e.g. for a local mock in E2E, an Azure/OpenAI proxy,
// or a self-hosted gateway) via OPENAI_BASE_URL. Trailing slashes are trimmed.
export const OPENAI_BASE_URL =
  cleanEnv(process.env.OPENAI_BASE_URL)?.replace(/\/+$/, '') ??
  'https://api.openai.com/v1'

const responsesUrl = (): string => `${OPENAI_BASE_URL}/responses`

export const isResponsesModel = (model?: string | null) =>
  !!model &&
  (model.startsWith('gpt-5.4-nano') || model.startsWith('gpt-5-nano'))

// --- Native tool calling types ---

export interface ResponsesApiTool {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, any>
}

export interface ToolCallResult {
  name: string
  arguments: Record<string, any>
  callId: string
}

export interface CompleteTextResult {
  text: string
  toolCalls: ToolCallResult[]
  usage?: { inputTokens: number; outputTokens: number }
}

/**
 * Call the Responses API (GPT‑5.4‑nano) with optional native tool calling.
 * When tools are provided, the model may return function_call outputs instead of text.
 */
export async function completeText({
  prompt,
  model = OPENAI_MODEL,
  apiKey,
  tools
}: {
  prompt: string
  model?: string | null
  apiKey?: string | null
  tools?: ResponsesApiTool[]
}): Promise<CompleteTextResult> {
  const m = model ?? OPENAI_MODEL

  if (!isResponsesModel(m)) {
    throw new Error(
      'completeText is only intended for responses-only models like gpt-5.4-nano.'
    )
  }

  const key = apiKey ?? process.env.OPENAI_API_KEY
  if (!key) {
    throw new Error('OPENAI_API_KEY is not configured.')
  }

  const body: Record<string, any> = {
    model: m,
    input: prompt
  }

  if (tools && tools.length > 0) {
    body.tools = tools
  }

  const res = await fetch(responsesUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => '')
    console.error('Responses API error', res.status, errorText)
    throw new Error(`Responses API error (${res.status})`)
  }

  const json = await res.json()
  return extractFromResponse(json, json?.usage)
}

/** Convert raw API usage to our typed format. */
const parseUsage = (
  rawUsage?: any
): { inputTokens: number; outputTokens: number } | undefined =>
  rawUsage
    ? {
        inputTokens: rawUsage.input_tokens ?? 0,
        outputTokens: rawUsage.output_tokens ?? 0
      }
    : undefined

/** Parse complete SSE events out of a buffer, returning parsed payloads and the remaining buffer. */
function processSseBuffer(buffer: string): {
  events: any[]
  remaining: string
} {
  const events: any[] = []
  let idx: number
  while ((idx = buffer.indexOf('\n\n')) !== -1) {
    const rawEvent = buffer.slice(0, idx)
    buffer = buffer.slice(idx + 2)

    let dataLine = ''
    for (const line of rawEvent.split('\n')) {
      if (line.startsWith('data: ')) dataLine += line.slice(6)
    }
    if (!dataLine) continue

    try {
      events.push(JSON.parse(dataLine))
    } catch {
      /* ignore malformed */
    }
  }

  // Avoid unbounded buffer growth in case of malformed streams.
  if (buffer.length > 16384) buffer = buffer.slice(-8192)
  return { events, remaining: buffer }
}

/**
 * Stream text tokens from the Responses API (GPT‑5.4‑nano) as a web stream.
 * This is used for real-time UX in chat endpoints.
 * Does NOT support tools — use completeText() for the tool-decision call.
 */
export async function streamText({
  prompt,
  model = OPENAI_MODEL,
  apiKey,
  onToken,
  onDone
}: {
  prompt: string
  model?: string | null
  apiKey?: string | null
  onToken?: (delta: string) => void | Promise<void>
  onDone?: (
    full: string,
    usage?: { inputTokens: number; outputTokens: number }
  ) => void | Promise<void>
}): Promise<ReadableStream<Uint8Array>> {
  const m = model ?? OPENAI_MODEL

  if (!isResponsesModel(m)) {
    throw new Error(
      'streamText is only intended for responses-only models like gpt-5.4-nano.'
    )
  }

  const key = apiKey ?? process.env.OPENAI_API_KEY
  if (!key) {
    throw new Error('OPENAI_API_KEY is not configured.')
  }

  const res = await fetch(responsesUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: m,
      input: prompt,
      stream: true
    })
  })

  if (!res.ok || !res.body) {
    const errorText = await res.text().catch(() => '')
    console.error('Responses API stream error', res.status, errorText)
    throw new Error(`Responses API stream error (${res.status})`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let buffer = ''
      let full = ''
      let streamUsage: { inputTokens: number; outputTokens: number } | undefined
      ;(async () => {
        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value, { stream: true })
            buffer += chunk

            const result = processSseBuffer(buffer)
            buffer = result.remaining

            for (const payload of result.events) {
              if (
                payload?.type === 'response.output_text.delta' &&
                typeof payload.delta === 'string'
              ) {
                full += payload.delta
                if (onToken) await onToken(payload.delta)
                controller.enqueue(encoder.encode(payload.delta))
              }
              if (payload?.type === 'response.completed') {
                streamUsage = parseUsage(payload?.response?.usage)
              }
            }
          }

          if (onDone) {
            await onDone(full, streamUsage)
          }
          controller.close()
        } catch (error) {
          console.error('Error while streaming Responses API', error)
          controller.error(error)
        }
      })()
    },
    cancel() {
      reader.cancel().catch(() => {
        /* ignore */
      })
    }
  })
}

/** Extract text from a Responses API message item. */
const extractMessageText = (item: any): string => {
  if (item?.type !== 'message' || !Array.isArray(item.content)) return ''
  const parts: string[] = []
  for (const part of item.content) {
    if (!part || part.type !== 'output_text') continue
    const t = (part as any).text
    if (typeof t === 'string') parts.push(t)
    else if (t && typeof t.value === 'string') parts.push(t.value)
  }
  return parts.join('')
}

/** Extract a tool call from a Responses API function_call item. */
const extractToolCall = (item: any): ToolCallResult | null => {
  if (item?.type !== 'function_call') return null
  let args: Record<string, any> = {}
  try {
    args =
      typeof item.arguments === 'string'
        ? JSON.parse(item.arguments)
        : (item.arguments ?? {})
  } catch {
    args = {}
  }
  return { name: item.name, arguments: args, callId: item.call_id ?? '' }
}

/**
 * Parse the Responses API output, extracting both text and function calls.
 */
const extractFromResponse = (json: any, rawUsage?: any): CompleteTextResult => {
  const output = json?.output
  const usage = parseUsage(rawUsage)
  if (!Array.isArray(output)) return { text: '', toolCalls: [], usage }

  let text = ''
  const toolCalls: ToolCallResult[] = []

  for (const item of output) {
    const msgText = extractMessageText(item)
    if (msgText) text = msgText

    const tc = extractToolCall(item)
    if (tc) toolCalls.push(tc)
  }

  return { text, toolCalls, usage }
}
