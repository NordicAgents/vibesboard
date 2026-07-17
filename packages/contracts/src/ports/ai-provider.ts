export interface IAIProvider {
  readonly kind: string
}

export type LlmProviderKind = 'openai' | 'anthropic' | 'openai_compatible' | 'google' | 'nvidia'

export type LlmTask = 'chat' | 'embed' | 'agent_creator' | '*'

export type ProviderModelSpec =
  | { kind: 'openai'; modelId: string; apiKey: string; baseUrl?: string }
  | { kind: 'anthropic'; modelId: string; apiKey: string }
  | { kind: 'openai_compatible'; modelId: string; apiKey: string; baseUrl: string }
  | { kind: 'google'; modelId: string; apiKey: string }
  // NVIDIA API Catalog (build.nvidia.com) — OpenAI-compatible hosted NIM
  // endpoints with a free tier. baseUrl defaults to the hosted catalog;
  // override it only for self-hosted NIM deployments.
  | { kind: 'nvidia'; modelId: string; apiKey: string; baseUrl?: string }
