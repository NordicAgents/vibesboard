import { afterEach, describe, expect, it } from 'vitest'

import { shouldResolveTenantProvider } from './provider-routing.ts'

const originalNodeEnv = process.env.NODE_ENV
const originalE2EForcePlatform = process.env.E2E_FORCE_PLATFORM_LLM

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv
  if (originalE2EForcePlatform === undefined) {
    delete process.env.E2E_FORCE_PLATFORM_LLM
  } else {
    process.env.E2E_FORCE_PLATFORM_LLM = originalE2EForcePlatform
  }
})

describe('shouldResolveTenantProvider', () => {
  it('resolves tenant providers during normal requests', () => {
    delete process.env.E2E_FORCE_PLATFORM_LLM
    expect(
      shouldResolveTenantProvider({ tenantId: 'tenant-1', previewToken: null })
    ).toBe(true)
  })

  it('uses the platform provider for preview tokens', () => {
    expect(
      shouldResolveTenantProvider({
        tenantId: 'tenant-1',
        previewToken: 'preview-token'
      })
    ).toBe(false)
  })

  it('uses the platform mock when explicitly enabled in non-production E2E', () => {
    process.env.NODE_ENV = 'development'
    process.env.E2E_FORCE_PLATFORM_LLM = 'true'
    expect(
      shouldResolveTenantProvider({ tenantId: 'tenant-1', previewToken: null })
    ).toBe(false)
  })

  it('cannot bypass tenant routing in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.E2E_FORCE_PLATFORM_LLM = 'true'
    expect(
      shouldResolveTenantProvider({ tenantId: 'tenant-1', previewToken: null })
    ).toBe(true)
  })
})
