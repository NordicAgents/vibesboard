/**
 * Lightweight OpenAI API helpers that replace openai-edge.
 * Uses direct fetch — no SDK dependency.
 */
import { safeFetch } from '@vibesboard/utils/safe-fetch'

function withoutTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value.charCodeAt(end - 1) === 47) end--
  return value.slice(0, end)
}

// Honor OPENAI_BASE_URL (E2E mock / proxy / gateway), defaulting to public OpenAI.
const OPENAI_BASE_URL =
  (process.env.OPENAI_BASE_URL
    ? withoutTrailingSlashes(process.env.OPENAI_BASE_URL.trim())
    : undefined) ?? 'https://api.openai.com/v1'
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
  apiKey?: string
  baseUrl?: string
  /** When true, skips the private-host SSRF check (tenant opted in via allowPrivateHosts). */
  allowPrivateHost?: boolean
  /** Specific private/on-prem hostnames approved for this tenant. */
  hostAllowlist?: string[]
  /**
   * NVIDIA NIM-specific: `input_type` parameter required by models like
   * `nvidia/nv-embed-v2` and `nvidia/llama-3.2-nv-embedqa-1b-v2`.
   * - `'passage'`  — for document/file indexing (default when set)
   * - `'query'`    — for search queries at retrieval time
   * Third-party models hosted on NVIDIA (baai/bge-m3, snowflake/arctic-embed)
   * do NOT need this — omit it for those.
   */
  inputType?: 'query' | 'passage'
  /**
   * Output vector width. Only sent when set, because not every model accepts
   * it. Needed for models whose native width is not one of the pgvector table
   * widths (384/768/1024/1536) — e.g. gemini-embedding-001 returns 3072 by
   * default, which providerFromDimension would misfile into the 768 table.
   * Verified against Gemini's OpenAI-compatible gateway: dimensions=1536
   * returns exactly 1536.
   */
  dimensions?: number
}): Promise<{ data: { embedding: number[]; index: number }[] }> {
  const url = params.baseUrl
    ? `${withoutTrailingSlashes(params.baseUrl)}/embeddings`
    : OPENAI_EMBEDDINGS
  const key = params.apiKey ?? getApiKey()
  const request = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: params.model,
      input: params.input,
      ...(params.inputType ? { input_type: params.inputType } : {}),
      ...(params.dimensions ? { dimensions: params.dimensions } : {})
    })
  }
  // Tenant-controlled endpoints are DNS-resolved, pinned, redirect-bounded,
  // and revalidated on every hop. Platform endpoints remain on ordinary fetch
  // so local test gateways configured through OPENAI_BASE_URL still work.
  const res = params.baseUrl
    ? await safeFetch(url, request, {
        allowPrivateHosts: params.allowPrivateHost,
        hostAllowlist: params.hostAllowlist,
        sensitiveHeaders: ['api-key', 'x-api-key']
      })
    : await fetch(url, request)

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
