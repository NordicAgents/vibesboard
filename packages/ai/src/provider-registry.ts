import 'server-only'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModel } from 'ai'
import type { LlmProviderKind, ProviderModelSpec } from '@vibesboard/contracts'

// ─── Context ─────────────────────────────────────────────────────────
// Shared infra passed to every factory. Empty for now; add AWS clients,
// feature-flag readers, etc. here without changing call sites.
export interface ProviderFactoryContext {}

// ─── Mapped-type registry ─────────────────────────────────────────────
// Adding a new variant to ProviderModelSpec without registering its factory
// here is a compile error — no switch default, no forgotten cases at runtime.
type ProviderFactoryRegistry = {
  [K in LlmProviderKind]: (
    spec: Extract<ProviderModelSpec, { kind: K }>,
    ctx: ProviderFactoryContext,
  ) => LanguageModel
}

const providerFactories: ProviderFactoryRegistry = {
  openai: (spec) =>
    createOpenAI({
      apiKey: spec.apiKey,
      ...(spec.baseUrl ? { baseURL: spec.baseUrl } : {}),
    })(spec.modelId),

  anthropic: (spec) =>
    createAnthropic({ apiKey: spec.apiKey })(spec.modelId),

  openai_compatible: (spec) =>
    createOpenAI({
      apiKey: spec.apiKey,
      baseURL: spec.baseUrl,
      compatibility: 'compatible',
    })(spec.modelId),
}

// ─── Public dispatcher ────────────────────────────────────────────────
export function buildProviderModel(
  spec: ProviderModelSpec,
  ctx: ProviderFactoryContext = {},
): LanguageModel {
  const factory = providerFactories[spec.kind] as (
    spec: ProviderModelSpec,
    ctx: ProviderFactoryContext,
  ) => LanguageModel
  return factory(spec, ctx)
}
