import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateText = vi.fn(async () => ({ text: 'tenant vision text' }))
const chatCompletionWithVision = vi.fn(async () => {
  throw new Error('platform vision must not be used for a configured tenant')
})
const resolveProviderSpec = vi.fn(async () => ({
  kind: 'anthropic',
  modelId: 'tenant-vision-model',
  apiKey: 'redacted-test-key'
}))
const buildTenantProviderModel = vi.fn(async () => ({
  provider: 'tenant-model'
}))

vi.mock('ai', () => ({ generateText }))
vi.mock('@vibesboard/adapter-openai', () => ({
  OPENAI_VISION_MODEL: 'legacy-platform-vision',
  isResponsesModel: () => false,
  chatCompletionWithVision
}))
vi.mock('@vibesboard/adapter-s3', () => ({ downloadFile: vi.fn() }))
vi.mock('@vibesboard/ai/rag-store', () => ({
  replaceFileChunks: vi.fn(),
  providerFromDimension: vi.fn()
}))
vi.mock('./tenant-llm-config.ts', () => ({
  resolveProviderSpec,
  resolveEmbedder: vi.fn()
}))
vi.mock('./provider-registry.ts', () => ({ buildTenantProviderModel }))
vi.mock('./provider-routing.ts', () => ({
  shouldResolveTenantProvider: () => true
}))
vi.mock('@vibesboard/adapter-postgres/client', () => ({
  getMigrateDb: vi.fn()
}))
vi.mock('@vibesboard/adapter-postgres/schema', () => ({ files: {} }))

const { extractTextFromBuffer } = await import('./file-search.ts')

describe('image extraction provider routing', () => {
  beforeEach(() => {
    generateText.mockClear()
    chatCompletionWithVision.mockClear()
    resolveProviderSpec.mockClear()
    buildTenantProviderModel.mockClear()
  })

  it('uses the tenant provider without falling back to platform vision', async () => {
    const text = await extractTextFromBuffer(
      Buffer.from('small image'),
      'image/png',
      { tenantId: 'tenant-a' }
    )

    expect(text).toBe('tenant vision text')
    expect(resolveProviderSpec).toHaveBeenCalledWith(
      'tenant-a',
      null,
      undefined,
      'chat'
    )
    expect(generateText).toHaveBeenCalledOnce()
    expect(chatCompletionWithVision).not.toHaveBeenCalled()
  })
})
