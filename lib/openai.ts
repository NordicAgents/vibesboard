import { Configuration, OpenAIApi } from 'openai-edge'

const cleanEnv = (value?: string) => value?.trim()

const baseModel = cleanEnv(process.env.OPENAI_MODEL) ?? 'gpt-5.4-nano'

export const OPENAI_MODEL = baseModel
export const OPENAI_CHAT_MODEL = baseModel

// Vision-capable model can be overridden separately; defaults to a safe vision model.
export const OPENAI_VISION_MODEL =
  cleanEnv(process.env.OPENAI_VISION_MODEL) ?? 'gpt-5.4-nano'

export const isResponsesModel = (model?: string | null) =>
  !!model && (model.startsWith('gpt-5.4-nano') || model.startsWith('gpt-5-nano'))

/**
 * Call the Responses API for text-only generations (used for GPT‑5.4‑nano).
 * Note: this intentionally does NOT send temperature, which is unsupported.
 */
export async function completeText({
  prompt,
  model = OPENAI_MODEL,
  apiKey
}: {
  prompt: string
  model?: string | null
  apiKey?: string | null
}): Promise<string> {
  const m = model ?? OPENAI_MODEL

  if (!isResponsesModel(m)) {
    throw new Error('completeText is only intended for responses-only models like gpt-5.4-nano.')
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
      input: prompt
    })
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => '')
    console.error('Responses API error', res.status, errorText)
    throw new Error(`Responses API error (${res.status})`)
  }

  const json = await res.json()
  return extractTextFromResponse(json)
}

/**
 * Stream text tokens from the Responses API (GPT‑5.4‑nano) as a web stream.
 * This is used for real-time UX in chat endpoints.
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

const extractTextFromResponse = (json: any): string => {
  const output = json?.output
  if (!Array.isArray(output)) return ''

  for (const item of output) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue

    const parts: string[] = []
    for (const part of item.content) {
      if (!part || part.type !== 'output_text') continue
      const text = (part as any).text
      if (typeof text === 'string') {
        parts.push(text)
      } else if (text && typeof text.value === 'string') {
        parts.push(text.value)
      }
    }

    if (parts.length) {
      return parts.join('')
    }
  }

  return ''
}
