export interface IAIProvider {
  readonly kind: string
}

export type LlmProviderKind = 'openai' | 'anthropic' | 'openai_compatible'

export type ProviderModelSpec =
  | { kind: 'openai'; modelId: string; apiKey: string; baseUrl?: string }
  | { kind: 'anthropic'; modelId: string; apiKey: string }
  | { kind: 'openai_compatible'; modelId: string; apiKey: string; baseUrl: string }
