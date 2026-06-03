import { describe, it, expect } from 'vitest'
// Warm up Vite's SSR module pipeline with a non-`server-only` sibling first so
// the `server-only` → no-op stub alias is applied before webhook-utils.ts (which
// leads with `import 'server-only'`) is resolved. Mirrors how policy/usage.test
// imports a plain module ahead of its `server-only`-leading unit under test.
import '../db.ts'
import { assertSafeCallbackUrl, signPayload } from '../webhook-utils.ts'

describe('assertSafeCallbackUrl (SSRF guard)', () => {
  it('accepts public http(s) URLs', () => {
    expect(() => assertSafeCallbackUrl('https://example.com/cb')).not.toThrow()
    expect(() => assertSafeCallbackUrl('http://api.acme.io/hook')).not.toThrow()
  })

  it('rejects non-http(s) protocols', () => {
    expect(() => assertSafeCallbackUrl('ftp://example.com')).toThrow(
      /http or https/
    )
    expect(() => assertSafeCallbackUrl('file:///etc/passwd')).toThrow(
      /http or https/
    )
  })

  it('rejects an unparseable URL', () => {
    // `new URL('not a url')` actually parses (scheme-relative), so use input
    // that genuinely fails URL parsing to hit the catch branch.
    expect(() => assertSafeCallbackUrl('http://')).toThrow(/Invalid callbackUrl/)
    expect(() => assertSafeCallbackUrl('')).toThrow(/Invalid callbackUrl/)
  })

  it('rejects localhost / loopback', () => {
    expect(() => assertSafeCallbackUrl('http://localhost/cb')).toThrow(
      /localhost/
    )
    expect(() => assertSafeCallbackUrl('http://127.0.0.1/cb')).toThrow(
      /localhost/
    )
    expect(() => assertSafeCallbackUrl('http://app.localhost/cb')).toThrow(
      /localhost/
    )
  })

  it('rejects private IPv4 ranges', () => {
    expect(() => assertSafeCallbackUrl('http://10.0.0.5/cb')).toThrow(
      /private IP/
    )
    expect(() => assertSafeCallbackUrl('http://172.16.0.1/cb')).toThrow(
      /private IP/
    )
    expect(() => assertSafeCallbackUrl('http://192.168.1.10/cb')).toThrow(
      /private IP/
    )
  })

  it('rejects the cloud metadata link-local address', () => {
    expect(() => assertSafeCallbackUrl('http://169.254.169.254/latest')).toThrow(
      /link-local/
    )
  })

  it('allows a public IPv4 that is just outside the private 172.x window', () => {
    expect(() => assertSafeCallbackUrl('http://172.32.0.1/cb')).not.toThrow()
  })
})

describe('signPayload', () => {
  it('is deterministic for the same payload + secret', () => {
    const a = signPayload('{"x":1}', 'secret')
    const b = signPayload('{"x":1}', 'secret')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when the payload or secret changes', () => {
    const base = signPayload('payload', 'secret')
    expect(signPayload('payload2', 'secret')).not.toBe(base)
    expect(signPayload('payload', 'secret2')).not.toBe(base)
  })
})
