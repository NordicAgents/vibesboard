import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// client.ts caches the S3Client in module scope and reads env eagerly the
// first time getS3Client() is called. To exercise different env combinations
// we reset the module registry before each scenario and dynamically import a
// fresh copy, so each test gets its own un-cached singleton.

const S3_ENV_KEYS = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_FORCE_PATH_STYLE',
] as const

let saved: Record<string, string | undefined>

function clearS3Env() {
  for (const k of S3_ENV_KEYS) delete process.env[k]
}

function setFullEnv() {
  process.env.S3_ENDPOINT = 'http://localhost:9000'
  process.env.S3_BUCKET = 'vibesboard-files'
  process.env.S3_ACCESS_KEY_ID = 'vibesboard'
  process.env.S3_SECRET_ACCESS_KEY = 'vibesboard'
}

async function freshClientModule() {
  vi.resetModules()
  return import('../client.ts')
}

beforeEach(() => {
  saved = {}
  for (const k of S3_ENV_KEYS) saved[k] = process.env[k]
  clearS3Env()
})

afterEach(() => {
  clearS3Env()
  for (const k of S3_ENV_KEYS) {
    if (saved[k] !== undefined) process.env[k] = saved[k]
  }
  vi.resetModules()
})

describe('getS3Client env handling', () => {
  it('builds a client whose endpoint resolves from S3_ENDPOINT', async () => {
    setFullEnv()
    const { getS3Client } = await freshClientModule()
    const client = getS3Client()

    const endpoint = await client.config.endpoint!()
    expect(endpoint.hostname).toBe('localhost')
    expect(endpoint.port).toBe(9000)
    expect(endpoint.protocol).toBe('http:')
  })

  it('resolves credentials from S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY', async () => {
    setFullEnv()
    process.env.S3_ACCESS_KEY_ID = 'AKIA-test'
    process.env.S3_SECRET_ACCESS_KEY = 'secret-test'
    const { getS3Client } = await freshClientModule()
    const creds = await getS3Client().config.credentials!()
    expect(creds.accessKeyId).toBe('AKIA-test')
    expect(creds.secretAccessKey).toBe('secret-test')
  })

  it('defaults region to us-east-1 when S3_REGION is unset', async () => {
    setFullEnv()
    const { getS3Client } = await freshClientModule()
    const region = await getS3Client().config.region!()
    expect(region).toBe('us-east-1')
  })

  it('honors an explicit S3_REGION', async () => {
    setFullEnv()
    process.env.S3_REGION = 'eu-north-1'
    const { getS3Client } = await freshClientModule()
    const region = await getS3Client().config.region!()
    expect(region).toBe('eu-north-1')
  })

  it('defaults forcePathStyle to true (MinIO) when S3_FORCE_PATH_STYLE is unset', async () => {
    setFullEnv()
    const { getS3Client } = await freshClientModule()
    expect(getS3Client().config.forcePathStyle).toBe(true)
  })

  it('sets forcePathStyle=false when S3_FORCE_PATH_STYLE === "false"', async () => {
    setFullEnv()
    process.env.S3_FORCE_PATH_STYLE = 'false'
    const { getS3Client } = await freshClientModule()
    expect(getS3Client().config.forcePathStyle).toBe(false)
  })

  it('treats any non-"true" value as forcePathStyle=false (strict equality)', async () => {
    setFullEnv()
    process.env.S3_FORCE_PATH_STYLE = '0'
    const { getS3Client } = await freshClientModule()
    expect(getS3Client().config.forcePathStyle).toBe(false)
  })

  it('sets forcePathStyle=true for the explicit "true" string', async () => {
    setFullEnv()
    process.env.S3_FORCE_PATH_STYLE = 'true'
    const { getS3Client } = await freshClientModule()
    expect(getS3Client().config.forcePathStyle).toBe(true)
  })

  it('caches the client as a singleton across calls', async () => {
    setFullEnv()
    const { getS3Client } = await freshClientModule()
    const a = getS3Client()
    const b = getS3Client()
    expect(a).toBe(b)
  })

  it('a fresh module yields a distinct client instance (no cross-module leakage)', async () => {
    setFullEnv()
    const mod1 = await freshClientModule()
    const c1 = mod1.getS3Client()
    const mod2 = await freshClientModule()
    const c2 = mod2.getS3Client()
    expect(c1).not.toBe(c2)
  })

  it('throws a clear error when S3_ENDPOINT is missing', async () => {
    setFullEnv()
    delete process.env.S3_ENDPOINT
    const { getS3Client } = await freshClientModule()
    expect(() => getS3Client()).toThrow(/S3_ENDPOINT is not set/)
  })

  it('throws when S3_ACCESS_KEY_ID is missing', async () => {
    setFullEnv()
    delete process.env.S3_ACCESS_KEY_ID
    const { getS3Client } = await freshClientModule()
    expect(() => getS3Client()).toThrow(/S3_ACCESS_KEY_ID is not set/)
  })

  it('throws when S3_SECRET_ACCESS_KEY is missing', async () => {
    setFullEnv()
    delete process.env.S3_SECRET_ACCESS_KEY
    const { getS3Client } = await freshClientModule()
    expect(() => getS3Client()).toThrow(/S3_SECRET_ACCESS_KEY is not set/)
  })

  it('treats an empty-string env var as unset (falsy) and throws', async () => {
    setFullEnv()
    process.env.S3_ENDPOINT = ''
    const { getS3Client } = await freshClientModule()
    expect(() => getS3Client()).toThrow(/S3_ENDPOINT is not set/)
  })

  it('error message points at .env.example', async () => {
    setFullEnv()
    delete process.env.S3_ENDPOINT
    const { getS3Client } = await freshClientModule()
    expect(() => getS3Client()).toThrow(/See \.env\.example/)
  })
})

describe('getBucket env handling', () => {
  it('returns the S3_BUCKET value', async () => {
    setFullEnv()
    process.env.S3_BUCKET = 'my-bucket'
    const { getBucket } = await freshClientModule()
    expect(getBucket()).toBe('my-bucket')
  })

  it('throws a clear error when S3_BUCKET is missing', async () => {
    setFullEnv()
    delete process.env.S3_BUCKET
    const { getBucket } = await freshClientModule()
    expect(() => getBucket()).toThrow(/S3_BUCKET is not set/)
  })

  it('does not require S3 client credentials to be present', async () => {
    // getBucket reads S3_BUCKET only; it must work even if other S3 creds
    // are absent (it never touches getS3Client()).
    clearS3Env()
    process.env.S3_BUCKET = 'standalone-bucket'
    const { getBucket } = await freshClientModule()
    expect(getBucket()).toBe('standalone-bucket')
  })
})
