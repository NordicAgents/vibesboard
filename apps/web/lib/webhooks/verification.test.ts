// HIGH priority: webhook signature/token verification is the trust boundary for
// inbound Meta/WhatsApp events. A forged or tampered body must be rejected, and
// the verify token must match exactly (constant-time) for the GET handshake.
import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import {
  verifyWebhookSignature,
  verifyWebhookToken,
  verifyWebhookRequest
} from './verification.ts'

const SECRET = 'app-secret-xyz'
const sign = (body: string, secret = SECRET) =>
  // nosemgrep: javascript.lang.security.audit.hardcoded-hmac-key.hardcoded-hmac-key -- test-only fixture secret
  'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')

describe('verifyWebhookSignature', () => {
  it('accepts a valid signature', () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: []
    })
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true)
  })

  it('rejects a tampered body (signature computed over original)', () => {
    const original = JSON.stringify({ entry: [] })
    const sig = sign(original)
    const tampered = JSON.stringify({ entry: [{ evil: true }] })
    expect(verifyWebhookSignature(tampered, sig, SECRET)).toBe(false)
  })

  it('rejects a signature made with the wrong secret', () => {
    const body = JSON.stringify({ entry: [] })
    expect(
      verifyWebhookSignature(body, sign(body, 'attacker-secret'), SECRET)
    ).toBe(false)
  })

  it('rejects a non-sha256 algorithm prefix', () => {
    const body = '{}'
    // nosemgrep: javascript.lang.security.audit.hardcoded-hmac-key.hardcoded-hmac-key -- test-only fixture secret
    const hash = crypto.createHmac('sha256', SECRET).update(body).digest('hex')
    expect(verifyWebhookSignature(body, `sha1=${hash}`, SECRET)).toBe(false)
  })

  it('rejects a signature of the wrong length without throwing', () => {
    expect(verifyWebhookSignature('{}', 'sha256=abcd', SECRET)).toBe(false)
  })
})

describe('verifyWebhookToken', () => {
  it('accepts a matching token', () => {
    expect(verifyWebhookToken('verify-me', 'verify-me')).toBe(true)
  })

  it('rejects a non-matching token of equal length', () => {
    expect(verifyWebhookToken('verify-yo', 'verify-me')).toBe(false)
  })

  it('rejects a token of different length (without throwing)', () => {
    expect(verifyWebhookToken('short', 'verify-me')).toBe(false)
  })

  it('rejects when no expected token is configured', () => {
    expect(verifyWebhookToken('verify-me', undefined)).toBe(false)
  })
})

describe('verifyWebhookRequest', () => {
  const freshTimestamp = () => String(Math.floor(Date.now() / 1000))

  it('accepts a valid signature + fresh timestamp', () => {
    const body = JSON.stringify({ object: 'x', entry: [] })
    const result = verifyWebhookRequest(
      body,
      {
        'x-hub-signature-256': sign(body),
        'x-hub-timestamp': freshTimestamp()
      },
      SECRET
    )
    expect(result.valid).toBe(true)
  })

  it('rejects a missing signature header', () => {
    const result = verifyWebhookRequest(
      '{}',
      { 'x-hub-timestamp': freshTimestamp() },
      SECRET
    )
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('rejects a missing timestamp header', () => {
    const body = '{}'
    const result = verifyWebhookRequest(
      body,
      { 'x-hub-signature-256': sign(body) },
      SECRET
    )
    expect(result.valid).toBe(false)
  })

  it('rejects a stale timestamp (replay window exceeded)', () => {
    const body = '{}'
    const stale = String(Math.floor(Date.now() / 1000) - 1000)
    const result = verifyWebhookRequest(
      body,
      { 'x-hub-signature-256': sign(body), 'x-hub-timestamp': stale },
      SECRET
    )
    expect(result.valid).toBe(false)
  })

  it('rejects a tampered body even with a fresh timestamp', () => {
    const original = '{}'
    const sig = sign(original)
    const result = verifyWebhookRequest(
      '{"tampered":true}',
      { 'x-hub-signature-256': sig, 'x-hub-timestamp': freshTimestamp() },
      SECRET
    )
    expect(result.valid).toBe(false)
  })
})
