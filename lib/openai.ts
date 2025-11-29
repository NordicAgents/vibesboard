import { Configuration, OpenAIApi } from 'openai-edge'

const cleanEnv = (value?: string) => value?.trim()

const baseModel = cleanEnv(process.env.OPENAI_MODEL) ?? 'gpt-5-nano'

export const OPENAI_MODEL = baseModel
export const OPENAI_CHAT_MODEL = baseModel

// Vision-capable model can be overridden separately; defaults to a safe vision model.
export const OPENAI_VISION_MODEL =
  cleanEnv(process.env.OPENAI_VISION_MODEL) ?? 'gpt-4o-mini'

export const isResponsesModel = (model?: string | null) =>
  !!model && model.startsWith('gpt-5-nano')

/**
 * Call the Responses API for text-only generations (used for GPT‑5‑nano).
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
    throw new Error('completeText is only intended for responses-only models like gpt-5-nano.')
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
