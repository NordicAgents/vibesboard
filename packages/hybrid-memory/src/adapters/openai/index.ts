import type { LLMProvider, LLMOptions } from '../../interfaces/llm.ts'
import type { Embedder } from '../../interfaces/embedder.ts'

// ─── OpenAI LLM Provider ──────────────────────────────────────────────────────

export interface OpenAILLMConfig {
  apiKey: string
  baseUrl?: string
  defaultModel?: string
}

export class OpenAILLMProvider implements LLMProvider {
  private apiKey: string
  private baseUrl: string
  private defaultModel: string

  constructor(config: OpenAILLMConfig) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl?.replace(/\/+$/, '') ?? 'https://api.openai.com/v1'
    this.defaultModel = config.defaultModel ?? 'gpt-4o-mini'
  }

  async complete(prompt: string, options: LLMOptions = {}): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model ?? this.defaultModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.2,
      }),
    })

    if (!res.ok) {
      throw new Error(`OpenAI LLM error ${res.status}: ${await res.text()}`)
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>
    }
    return data.choices[0]?.message.content ?? ''
  }
}

// ─── OpenAI Embedder ──────────────────────────────────────────────────────────

export interface OpenAIEmbedderConfig {
  apiKey: string
  baseUrl?: string
  model?: string
}

export class OpenAIEmbedder implements Embedder {
  private apiKey: string
  private baseUrl: string
  private model: string

  constructor(config: OpenAIEmbedderConfig) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl?.replace(/\/+$/, '') ?? 'https://api.openai.com/v1'
    this.model = config.model ?? 'text-embedding-3-small'
  }

  async embed(text: string): Promise<number[]> {
    const [embedding] = await this.embedBatch([text])
    return embedding
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    })

    if (!res.ok) {
      throw new Error(`OpenAI Embedder error ${res.status}: ${await res.text()}`)
    }

    const data = await res.json() as {
      data: Array<{ embedding: number[]; index: number }>
    }

    // Sort by index to preserve order
    return data.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding)
  }
}
