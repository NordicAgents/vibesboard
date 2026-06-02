import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import crypto from 'node:crypto'
import { RISC_EVENTS } from '../risc.ts'

// risc.ts keeps a module-level `jwksCache`. To make every fetch-count and
// error-path assertion deterministic regardless of test order, we load a FRESH
// copy of the module per test via vi.resetModules() + dynamic import, so the
// cache always starts empty. We never modify the source to do this.
async function freshVerifyRiscToken() {
  vi.resetModules()
  const mod = await import('../risc.ts')
  return mod.verifyRiscToken
}

// ---------------------------------------------------------------------------
// Helpers: a real RSA keypair so we can produce genuinely-verifiable JWTs and
// stub Google's RISC discovery + JWKS endpoints through globalThis.fetch.
// ---------------------------------------------------------------------------

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
})

const KID = 'test-kid-1'

function jwkForPublicKey(kid: string): JsonWebKey & { kid: string } {
  const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey
  return { ...jwk, kid, use: 'sig', alg: 'RS256' }
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

function signJwt(payload: Record<string, unknown>, opts: { kid?: string } = {}): string {
  const header = { alg: 'RS256', typ: 'JWT', kid: opts.kid ?? KID }
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(privateKey)
  return `${signingInput}.${b64url(signature)}`
}

const RISC_CONFIG_URL = 'https://accounts.google.com/.well-known/risc-configuration'
const JWKS_URL = 'https://www.googleapis.com/jwks'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response
}

const realFetch = globalThis.fetch
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

// Default happy-path wiring: config -> jwks_uri, then jwks with our key.
function wireHappyJwks(keys: Array<JsonWebKey & { kid: string }> = [jwkForPublicKey(KID)]) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === RISC_CONFIG_URL) return jsonResponse({ jwks_uri: JWKS_URL })
    if (url === JWKS_URL) return jsonResponse({ keys })
    throw new Error(`unexpected fetch: ${url}`)
  })
}

function validPayload() {
  return {
    iss: 'https://accounts.google.com',
    aud: 'client-id',
    iat: 1700000000,
    jti: 'jti-123',
    events: {
      [RISC_EVENTS.SESSIONS_REVOKED]: {
        subject: { subject_type: 'iss-sub', iss: 'https://accounts.google.com', sub: 'abc' },
      },
    },
  }
}

describe('RISC_EVENTS constants', () => {
  it('uses the OpenID secevent RISC prefix for every event type', () => {
    const prefix = 'https://schemas.openid.net/secevent/risc/event-type/'
    for (const value of Object.values(RISC_EVENTS)) {
      expect(value.startsWith(prefix)).toBe(true)
    }
  })

  it('maps each key to its expected event suffix', () => {
    expect(RISC_EVENTS.SESSIONS_REVOKED).toBe(
      'https://schemas.openid.net/secevent/risc/event-type/sessions-revoked',
    )
    expect(RISC_EVENTS.TOKENS_REVOKED).toBe(
      'https://schemas.openid.net/secevent/risc/event-type/tokens-revoked',
    )
    expect(RISC_EVENTS.ACCOUNT_DISABLED).toBe(
      'https://schemas.openid.net/secevent/risc/event-type/account-disabled',
    )
    expect(RISC_EVENTS.ACCOUNT_ENABLED).toBe(
      'https://schemas.openid.net/secevent/risc/event-type/account-enabled',
    )
    expect(RISC_EVENTS.VERIFICATION).toBe(
      'https://schemas.openid.net/secevent/risc/event-type/verification',
    )
  })
})

describe('verifyRiscToken', () => {
  it('verifies a well-formed, correctly-signed token and returns the payload', async () => {
    wireHappyJwks()
    const verifyRiscToken = await freshVerifyRiscToken()
    const token = signJwt(validPayload())

    const result = await verifyRiscToken(token)

    expect(result.iss).toBe('https://accounts.google.com')
    expect(result.jti).toBe('jti-123')
    expect(Object.keys(result.events)).toContain(RISC_EVENTS.SESSIONS_REVOKED)
    expect(fetchMock).toHaveBeenCalledWith(RISC_CONFIG_URL)
    expect(fetchMock).toHaveBeenCalledWith(JWKS_URL)
  })

  it('accepts the issuer with a trailing slash (Google sends both forms)', async () => {
    wireHappyJwks()
    const verifyRiscToken = await freshVerifyRiscToken()
    const token = signJwt({ ...validPayload(), iss: 'https://accounts.google.com/' })
    const result = await verifyRiscToken(token)
    expect(result.iss).toBe('https://accounts.google.com/')
  })

  it('accepts the bare-host issuer form', async () => {
    wireHappyJwks()
    const verifyRiscToken = await freshVerifyRiscToken()
    const token = signJwt({ ...validPayload(), iss: 'accounts.google.com' })
    const result = await verifyRiscToken(token)
    expect(result.iss).toBe('accounts.google.com')
  })

  it('accepts a token for ANY audience (signature + issuer are the trust anchors)', async () => {
    wireHappyJwks()
    const verifyRiscToken = await freshVerifyRiscToken()
    const token = signJwt({ ...validPayload(), aud: 'some-other-client-id' })
    const result = await verifyRiscToken(token)
    expect(result.aud).toBe('some-other-client-id')
  })

  it('rejects a token that is not three dot-separated parts', async () => {
    const verifyRiscToken = await freshVerifyRiscToken()
    await expect(verifyRiscToken('not.a.valid.jwt.token')).rejects.toThrow(/Invalid JWT format/)
    await expect(verifyRiscToken('onlyonepart')).rejects.toThrow(/Invalid JWT format/)
    // No network access for a malformed token.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a token whose issuer is not Google', async () => {
    wireHappyJwks()
    const verifyRiscToken = await freshVerifyRiscToken()
    const token = signJwt({ ...validPayload(), iss: 'https://evil.example.com' })
    await expect(verifyRiscToken(token)).rejects.toThrow(/Invalid issuer/)
  })

  it('rejects a token whose signature does not match the JWKS key', async () => {
    // Serve a DIFFERENT public key under the same kid -> signature check fails.
    const otherPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const otherJwk = {
      ...(otherPair.publicKey.export({ format: 'jwk' }) as JsonWebKey),
      kid: KID,
      use: 'sig',
      alg: 'RS256',
    }
    wireHappyJwks([otherJwk])
    const verifyRiscToken = await freshVerifyRiscToken()
    const token = signJwt(validPayload())
    await expect(verifyRiscToken(token)).rejects.toThrow(/Invalid JWT signature/)
  })

  it('retries once with a fresh JWKS fetch on a kid miss, then succeeds', async () => {
    // First jwks has the WRONG kid; the refetch returns the right one.
    let round = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (url === RISC_CONFIG_URL) return jsonResponse({ jwks_uri: JWKS_URL })
      if (url === JWKS_URL) {
        round += 1
        const kid = round === 1 ? 'stale-kid' : KID
        return jsonResponse({ keys: [jwkForPublicKey(kid)] })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const verifyRiscToken = await freshVerifyRiscToken()
    const token = signJwt(validPayload())
    const result = await verifyRiscToken(token)
    expect(result.jti).toBe('jti-123')
    // Two JWKS fetches: initial miss + refetch.
    const jwksCalls = fetchMock.mock.calls.filter((c) => c[0] === JWKS_URL)
    expect(jwksCalls.length).toBe(2)
  })

  it('throws when no matching key is found even after the refetch', async () => {
    wireHappyJwks([jwkForPublicKey('never-matches')])
    const verifyRiscToken = await freshVerifyRiscToken()
    const token = signJwt(validPayload(), { kid: 'wanted-kid' })
    await expect(verifyRiscToken(token)).rejects.toThrow(/No matching key for kid: wanted-kid/)
  })

  it('propagates a failed RISC configuration fetch', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === RISC_CONFIG_URL) return jsonResponse({}, false, 503)
      throw new Error(`unexpected fetch: ${url}`)
    })
    const verifyRiscToken = await freshVerifyRiscToken()
    const token = signJwt(validPayload())
    await expect(verifyRiscToken(token)).rejects.toThrow(
      /Failed to fetch RISC configuration: 503/,
    )
  })

  it('propagates a failed JWKS fetch', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === RISC_CONFIG_URL) return jsonResponse({ jwks_uri: JWKS_URL })
      if (url === JWKS_URL) return jsonResponse({}, false, 500)
      throw new Error(`unexpected fetch: ${url}`)
    })
    const verifyRiscToken = await freshVerifyRiscToken()
    const token = signJwt(validPayload())
    await expect(verifyRiscToken(token)).rejects.toThrow(/Failed to fetch JWKS: 500/)
  })
})
