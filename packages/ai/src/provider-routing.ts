interface TenantProviderRoutingInput {
  tenantId?: string | null
  previewToken?: string | null
}

/**
 * Decide whether a request may use a workspace's configured model provider.
 * Deterministic E2E runs can force the platform mock in non-production only;
 * production always preserves normal tenant routing.
 */
export function shouldResolveTenantProvider({
  tenantId,
  previewToken
}: TenantProviderRoutingInput): boolean {
  if (!tenantId || previewToken) return false

  const e2ePlatformOverride =
    process.env.NODE_ENV !== 'production' &&
    process.env.E2E_FORCE_PLATFORM_LLM === 'true'

  return !e2ePlatformOverride
}
