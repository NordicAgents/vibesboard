export interface IAIProvider {
  readonly kind: string
}

export type LlmProviderKind = 'openai' | 'anthropic' | 'openai_compatible' | 'google'

export type LlmTask = 'chat' | 'embed' | 'agent_creator' | '*'

export type ProviderModelSpec =
  | { kind: 'openai'; modelId: string; apiKey: string; baseUrl?: string }
  | { kind: 'anthropic'; modelId: string; apiKey: string }
  | { kind: 'openai_compatible'; modelId: string; apiKey: string; baseUrl: string }
  | { kind: 'google'; modelId: string; apiKey: string }
