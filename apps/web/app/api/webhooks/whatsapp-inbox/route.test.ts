// HIGH priority (in-process route + signature trust boundary):
// The whatsapp-inbox webhook must reject forged/tampered payloads (signature
// failure -> 403) before invoking any message processing, echo the challenge on
// a valid GET handshake (token === WHATSAPP_INBOX_VERIFY_TOKEN), and process a
// correctly-signed payload (META_APP_SECRET). Env vars are read at request time,
// so they are set in beforeEach.
//
// The route imports `@/lib/webhooks/verification`; vitest does not rewrite that
// `@/` alias inside a route handler that also pulls in next/server, so we
// redirect it to the REAL implementation via vi.mock(importActual) — keeping the
// genuine HMAC verification logic under test.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import crypto from 'node:crypto'

vi.mock('@/lib/webhooks/verification', async () =>
  vi.importActual('../../../../lib/webhooks/verification.ts')
)

// Stub the channel webhook handlers so no real processing / network happens.
const processInboundMessagesMock = vi.fn(async () => undefined)
const processStatusUpdatesMock = vi.fn(async () => undefined)
vi.mock('@vibesboard/channel-whatsapp/webhook-handlers', () => ({
  processInboundMessages: (...args: unknown[]) =>
    processInboundMessagesMock(...args),
  processStatusUpdates: (...args: unknown[]) =>
    processStatusUpdatesMock(...args)
}))

const { GET, POST } = await import('./route.ts')

const SECRET = 'meta-app-secret'
const VERIFY_TOKEN = 'wa-inbox-verify'
const sign = (body: string) =>
  // nosemgrep: javascript.lang.security.audit.hardcoded-hmac-key.hardcoded-hmac-key -- test-only fixture secret
  'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex')

// A signed inbound-message payload that drives processInboundMessages.
const inboundBody = () =>
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'pn-1' },
              messages: [{ id: 'm1', from: '123', type: 'text' }],
              contacts: [{ wa_id: '123' }]
            }
          }
        ]
      }
    ]
  })

beforeEach(() => {
  process.env.META_APP_SECRET = SECRET
  process.env.WHATSAPP_INBOX_VERIFY_TOKEN = VERIFY_TOKEN
  processInboundMessagesMock.mockClear()
  processStatusUpdatesMock.mockClear()
})
afterEach(() => {
  delete process.env.META_APP_SECRET
  delete process.env.WHATSAPP_INBOX_VERIFY_TOKEN
})

describe('GET /api/webhooks/whatsapp-inbox (verification handshake)', () => {
  it('echoes the challenge when mode and token match', async () => {
    const res = await GET(
      new Request(
        'http://localhost/api/webhooks/whatsapp-inbox?hub.mode=subscribe&hub.verify_token=wa-inbox-verify&hub.challenge=42'
      ) as never
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('42')
  })

  it('returns 403 for a wrong verify token', async () => {
    const res = await GET(
      new Request(
        'http://localhost/api/webhooks/whatsapp-inbox?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42'
      ) as never
    )
    expect(res.status).toBe(403)
  })
})

describe('POST /api/webhooks/whatsapp-inbox (signature trust boundary)', () => {
  it('processes inbound messages for a correctly-signed payload', async () => {
    const body = inboundBody()
    const res = await POST(
      new Request('http://localhost/api/webhooks/whatsapp-inbox', {
        method: 'POST',
        headers: { 'x-hub-signature-256': sign(body) },
        body
      }) as never
    )
    expect(res.status).toBe(200)
    expect(processInboundMessagesMock).toHaveBeenCalledOnce()
  })

  it('rejects a tampered body (403) and does NOT process it', async () => {
    const original = inboundBody()
    const goodSig = sign(original)
    const tampered = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: 'evil', changes: [] }]
    })
    const res = await POST(
      new Request('http://localhost/api/webhooks/whatsapp-inbox', {
        method: 'POST',
        headers: { 'x-hub-signature-256': goodSig },
        body: tampered
      }) as never
    )
    expect(res.status).toBe(403)
    expect(processInboundMessagesMock).not.toHaveBeenCalled()
  })

  it('rejects a missing signature header (403)', async () => {
    const res = await POST(
      new Request('http://localhost/api/webhooks/whatsapp-inbox', {
        method: 'POST',
        body: inboundBody()
      }) as never
    )
    expect(res.status).toBe(403)
    expect(processInboundMessagesMock).not.toHaveBeenCalled()
  })

  it('rejects when META_APP_SECRET is unconfigured (403), even with a header', async () => {
    delete process.env.META_APP_SECRET
    const body = inboundBody()
    const res = await POST(
      new Request('http://localhost/api/webhooks/whatsapp-inbox', {
        method: 'POST',
        headers: { 'x-hub-signature-256': sign(body) },
        body
      }) as never
    )
    expect(res.status).toBe(403)
    expect(processInboundMessagesMock).not.toHaveBeenCalled()
  })
})
