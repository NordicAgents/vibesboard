/**
 * Minimal LLM interface — implement once for your provider.
 * OpenAI, Anthropic, Ollama, Groq — all just need complete().
 */
export interface LLMProvider {
  complete(prompt: string, options?: LLMOptions): Promise<string>
}

export interface LLMOptions {
  maxTokens?: number
  temperature?: number
  /** Optional model override for specific pipeline stages */
  model?: string
}
