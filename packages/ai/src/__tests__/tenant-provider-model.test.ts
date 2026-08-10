import { describe, expect, it, vi } from 'vitest'
import { buildTenantProviderModel } from '../provider-registry.ts'

describe('buildTenantProviderModel', () => {
  it('applies the tenant network policy to private provider URLs', async () => {
    const resolveNetwork = vi.fn(async () => ({
      allowPrivateHosts: true,
      hostAllowlist: [] as string[]
    }))

    const model = await buildTenantProviderModel(
      'tenant-1',
      {
        kind: 'openai_compatible',
        apiKey: 'test-key',
        modelId: 'local-model',
        baseUrl: 'http://localhost:11434/v1'
      },
      resolveNetwork
    )

    expect(model).toBeTruthy()
    expect(resolveNetwork).toHaveBeenCalledWith('tenant-1')
  })
})
