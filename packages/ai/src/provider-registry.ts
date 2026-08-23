import 'server-only'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'
import type { LlmProviderKind, ProviderModelSpec } from '@vibesboard/contracts'
import { safeFetch } from '@vibesboard/utils/safe-fetch'
import { validateProviderBaseUrl } from './provider-ssrf-guard.ts'
import { buildNvidiaFetch } from './nvidia-stream-adapter.ts'
import { resolveTenantNetworkOpts } from './tenant-llm-config.ts'

// Re-exported so existing importers of this module keep working; defined in a
// leaf module because tenant-llm-config.ts needs it too (see provider-endpoints.ts).
export { NVIDIA_API_BASE_URL } from './provider-endpoints.ts'
import { NVIDIA_API_BASE_URL } from './provider-endpoints.ts'

// ─── Context ─────────────────────────────────────────────────────────
// Shared infra passed to every factory. Empty for now; add AWS clients,
// feature-flag readers, etc. here without changing call sites.
export interface ProviderFactoryContext {
  networkOpts?: ProviderNetworkOpts
}

function tenantSafeFetch(networkOpts: ProviderNetworkOpts = {}) {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    return safeFetch(url, init, {
      ...networkOpts,
      timeoutMs: 120_000,
      sensitiveHeaders: ['api-key', 'x-api-key']
    })
  }) as typeof fetch
}

// ─── Mapped-type registry ─────────────────────────────────────────────
// Adding a new variant to ProviderModelSpec without registering its factory
// here is a compile error — no switch default, no forgotten cases at runtime.
type ProviderFactoryRegistry = {
  [K in LlmProviderKind]: (
    spec: Extract<ProviderModelSpec, { kind: K }>,
    ctx: ProviderFactoryContext
  ) => LanguageModel
}

const providerFactories: ProviderFactoryRegistry = {
  openai: (spec, ctx) =>
    createOpenAI({
      apiKey: spec.apiKey,
      ...(spec.baseUrl ? { baseURL: spec.baseUrl } : {}),
      ...(spec.baseUrl ? { fetch: tenantSafeFetch(ctx.networkOpts) } : {})
    })(spec.modelId),

  anthropic: spec => createAnthropic({ apiKey: spec.apiKey })(spec.modelId),

  // `.chat()` — a gateway is "OpenAI-compatible" precisely because it serves
  // /chat/completions; almost none implement /responses, which is where the
  // bare call would land on @ai-sdk/openai@4.
  openai_compatible: (spec, ctx) =>
    createOpenAI({
      apiKey: spec.apiKey,
      baseURL: spec.baseUrl,
      fetch: tenantSafeFetch(ctx.networkOpts)
    }).chat(spec.modelId),

  google: spec =>
    createGoogleGenerativeAI({ apiKey: spec.apiKey })(spec.modelId),

  // .chat() for the same reason as openai_compatible: integrate.api.nvidia.com
  // serves /chat/completions and has no /responses endpoint, so the callable's
  // Responses-API default fails with HTTP 400 "data did not match any variant
  // of untagged enum InputParam". buildNvidiaFetch() also rewrites
  // chat.completion.chunk SSE frames, which only exist on this endpoint.
  nvidia: (spec, ctx) =>
    createOpenAI({
      apiKey: spec.apiKey,
      baseURL: spec.baseUrl ?? NVIDIA_API_BASE_URL,
      // NVIDIA reasoning models (Nemotron Ultra, DeepSeek V4 Pro, Qwen3 Coder)
      // return text in delta.reasoning_content rather than delta.content, which
      // the SDK's chunk schema drops; buildNvidiaFetch() promotes it to content.
      fetch: buildNvidiaFetch(
        spec.baseUrl ? tenantSafeFetch(ctx.networkOpts) : fetch
      )
      // `.chat()` — NVIDIA's API serves /chat/completions only.
    }).chat(spec.modelId)
}

export interface ProviderNetworkOpts {
  allowPrivateHosts?: boolean
  hostAllowlist?: string[]
}

// ─── Public dispatcher ────────────────────────────────────────────────
export function buildProviderModel(
  spec: ProviderModelSpec,
  ctx: ProviderFactoryContext = {},
  networkOpts: ProviderNetworkOpts = {}
): LanguageModel {
  // Defense-in-depth: re-validate baseUrl at call time so the runtime path
  // can't be bypassed by a URL that passed the save-time check but was later
  // DNS-rebound. Thread tenant network opts (allowPrivateHosts, hostAllowlist)
  // so Ollama / on-prem providers work for tenants that opted in.
  if ('baseUrl' in spec && spec.baseUrl) {
    const check = validateProviderBaseUrl(spec.baseUrl, networkOpts)
    if (!check.ok) throw new Error(`SSRF guard: ${check.error}`)
  }

  const factory = providerFactories[spec.kind] as (
    spec: ProviderModelSpec,
    ctx: ProviderFactoryContext
  ) => LanguageModel
  return factory(spec, { ...ctx, networkOpts })
}

type NetworkOptsResolver = typeof resolveTenantNetworkOpts

/** Build a tenant model with the tenant's private-host and host-allowlist policy. */
export async function buildTenantProviderModel(
  tenantId: string,
  spec: ProviderModelSpec,
  resolveNetworkOpts: NetworkOptsResolver = resolveTenantNetworkOpts
): Promise<LanguageModel> {
  const networkOpts = await resolveNetworkOpts(tenantId)
  return buildProviderModel(spec, {}, networkOpts)
}
