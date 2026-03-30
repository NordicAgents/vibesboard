const cleanEnv = (value?: string) => value?.trim()

const baseModel = cleanEnv(process.env.OPENAI_MODEL) ?? 'gpt-5.4-nano'

export const OPENAI_MODEL = baseModel
export const OPENAI_CHAT_MODEL = baseModel

// Vision-capable model can be overridden separately; defaults to a safe vision model.
export const OPENAI_VISION_MODEL =
  cleanEnv(process.env.OPENAI_VISION_MODEL) ?? 'gpt-5.4-nano'

export const isResponsesModel = (model?: string | null) =>
  !!model && (model.startsWith('gpt-5.4-nano') || model.startsWith('gpt-5-nano'))

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
    throw new Error('completeText is only intended for responses-only models like gpt-5.4-nano.')
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

  const res = await fetch('https://api.openai.com/v1/responses', {
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
  return extractFromResponse(json)
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
  onDone?: (full: string) => void | Promise<void>
}): Promise<ReadableStream<Uint8Array>> {
  const m = model ?? OPENAI_MODEL

  if (!isResponsesModel(m)) {
    throw new Error('streamText is only intended for responses-only models like gpt-5.4-nano.')
  }

  const key = apiKey ?? process.env.OPENAI_API_KEY
  if (!key) {
    throw new Error('OPENAI_API_KEY is not configured.')
  }

  const res = await fetch('https://api.openai.com/v1/responses', {
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

      ;(async () => {
        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value, { stream: true })
            buffer += chunk

            let idx: number
            while ((idx = buffer.indexOf('\n\n')) !== -1) {
              const rawEvent = buffer.slice(0, idx)
              buffer = buffer.slice(idx + 2)

              const lines = rawEvent.split('\n')
              let dataLine = ''
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  dataLine += line.slice(6)
                }
              }
              if (!dataLine) continue

              try {
                const payload = JSON.parse(dataLine)
                if (
                  payload?.type === 'response.output_text.delta' &&
                  typeof payload.delta === 'string'
                ) {
                  const delta: string = payload.delta
                  full += delta
                  if (onToken) {
                    await onToken(delta)
                  }
                  controller.enqueue(encoder.encode(delta))
                }
              } catch {
                // Ignore malformed SSE chunks
              }
            }

            // Avoid unbounded buffer growth in case of malformed streams.
            if (buffer.length > 16384) {
              buffer = buffer.slice(-8192)
            }
          }

          if (onDone) {
            await onDone(full)
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

/**
 * Parse the Responses API output, extracting both text and function calls.
 */
const extractFromResponse = (json: any): CompleteTextResult => {
  const output = json?.output
  if (!Array.isArray(output)) return { text: '', toolCalls: [] }

  let text = ''
  const toolCalls: ToolCallResult[] = []

  for (const item of output) {
    // Text message output
    if (item?.type === 'message' && Array.isArray(item.content)) {
      const parts: string[] = []
      for (const part of item.content) {
        if (!part || part.type !== 'output_text') continue
        const t = (part as any).text
        if (typeof t === 'string') {
          parts.push(t)
        } else if (t && typeof t.value === 'string') {
          parts.push(t.value)
        }
      }
      if (parts.length) {
        text = parts.join('')
      }
    }

    // Function call output
    if (item?.type === 'function_call') {
      let args: Record<string, any> = {}
      try {
        args = typeof item.arguments === 'string'
          ? JSON.parse(item.arguments)
          : (item.arguments ?? {})
      } catch {
        args = {}
      }
      toolCalls.push({
        name: item.name,
        arguments: args,
        callId: item.call_id ?? ''
      })
    }
  }

  return { text, toolCalls }
}
