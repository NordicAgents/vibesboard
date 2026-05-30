/**
 * Lightweight OpenAI API helpers that replace openai-edge.
 * Uses direct fetch — no SDK dependency.
 */

// Honor OPENAI_BASE_URL (E2E mock / proxy / gateway), defaulting to public OpenAI.
const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL?.trim().replace(/\/+$/, '') ??
  'https://api.openai.com/v1'
const OPENAI_CHAT_COMPLETIONS = `${OPENAI_BASE_URL}/chat/completions`
const OPENAI_EMBEDDINGS = `${OPENAI_BASE_URL}/embeddings`

const getApiKey = () => {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY is not configured')
  return key
}

const headers = () => ({
  Authorization: `Bearer ${getApiKey()}`,
  'Content-Type': 'application/json'
})

/**
 * Non-streaming chat completion. Drop-in replacement for
 * openai.createChatCompletion() from openai-edge.
 */
export async function chatCompletion(params: {
  model: string
  messages: { role: string; content: string }[]
  temperature?: number
  max_tokens?: number
}): Promise<{ choices: { message: { content: string } }[] }> {
  const res = await fetch(OPENAI_CHAT_COMPLETIONS, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.2,
      max_tokens: params.max_tokens,
      stream: false
    })
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenAI chat completion error (${res.status}): ${text}`)
  }

  return res.json()
}

/**
 * Create embeddings. Drop-in replacement for
 * openai.createEmbedding() from openai-edge.
 */
export async function createEmbedding(params: {
  model: string
  input: string | string[]
}): Promise<{ data: { embedding: number[]; index: number }[] }> {
  const res = await fetch(OPENAI_EMBEDDINGS, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: params.model,
      input: params.input
    })
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenAI embedding error (${res.status}): ${text}`)
  }

  return res.json()
}

/**
 * Non-streaming chat completion with vision (image URLs in messages).
 * Used by file-search.ts for image description.
 */
export async function chatCompletionWithVision(params: {
  model: string
  messages: any[]
  max_tokens?: number
}): Promise<{ choices: { message: { content: string } }[] }> {
  const res = await fetch(OPENAI_CHAT_COMPLETIONS, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      max_tokens: params.max_tokens ?? 300,
      stream: false
    })
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenAI vision completion error (${res.status}): ${text}`)
  }

  return res.json()
}
