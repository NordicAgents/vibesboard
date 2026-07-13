import 'server-only'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'
import type { LlmProviderKind, ProviderModelSpec } from '@vibesboard/contracts'
import { validateProviderBaseUrl } from './provider-ssrf-guard.ts'

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

  google: (spec) =>
    createGoogleGenerativeAI({ apiKey: spec.apiKey })(spec.modelId),
}

// ─── Public dispatcher ────────────────────────────────────────────────
export function buildProviderModel(
  spec: ProviderModelSpec,
  ctx: ProviderFactoryContext = {},
): LanguageModel {
  // Defense-in-depth: re-validate baseUrl at call time so the runtime path
  // (runtime.ts, summarize.ts, agent-creator, etc.) can't be bypassed by a
  // URL that passed the save-time string check but was later DNS-rebound.
  // allowPrivateHosts/hostAllowlist are not threaded here (runtime has no
  // tenant context at model-construction time) — private hosts are gated at
  // the save route level for standard spec; the Google raw-fetch path in
  // runtime.ts uses the Gemini public endpoint so it's unaffected.
  if ('baseUrl' in spec && spec.baseUrl) {
    const check = validateProviderBaseUrl(spec.baseUrl)
    if (!check.ok) throw new Error(`SSRF guard: ${check.error}`)
  }

  const factory = providerFactories[spec.kind] as (
    spec: ProviderModelSpec,
    ctx: ProviderFactoryContext,
  ) => LanguageModel
  return factory(spec, ctx)
}
