import { describe, it, expect } from 'vitest'
import { validateWebhookUrl } from '../validate-webhook-url.ts'

// SSRF protection: validateWebhookUrl must reject anything that could reach
// internal/private/metadata endpoints, and accept only public http(s) URLs.

describe('validateWebhookUrl — accepted URLs', () => {
  it('accepts a public https URL', () => {
    expect(validateWebhookUrl('https://example.com/hook')).toEqual({ ok: true })
  })

  it('accepts a public http URL', () => {
    expect(validateWebhookUrl('http://example.com/hook')).toEqual({ ok: true })
  })

  it('accepts a public IP that is not in any blocked range', () => {
    expect(validateWebhookUrl('https://8.8.8.8/hook')).toEqual({ ok: true })
  })

  it('accepts URLs with ports, paths and query strings', () => {
    expect(
      validateWebhookUrl('https://hooks.example.com:8443/path?x=1'),
    ).toEqual({ ok: true })
  })
})

describe('validateWebhookUrl — malformed input', () => {
  it('rejects an unparseable URL', () => {
    const r = validateWebhookUrl('not a url')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Invalid URL format')
  })

  it('rejects an empty string', () => {
    expect(validateWebhookUrl('').ok).toBe(false)
  })
})

describe('validateWebhookUrl — scheme restrictions', () => {
  it.each([
    'ftp://example.com',
    'file:///etc/passwd',
    'gopher://example.com',
    'data:text/plain,hello',
  ])('rejects non-http(s) scheme %s', (url) => {
    const r = validateWebhookUrl(url)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Only http and https URLs are allowed')
  })
})

describe('validateWebhookUrl — loopback', () => {
  it.each([
    'http://localhost/hook',
    'http://127.0.0.1/hook',
    'http://[::1]/hook',
    'http://0.0.0.0/hook',
  ])('rejects loopback %s', (url) => {
    expect(validateWebhookUrl(url).ok).toBe(false)
  })

  it('reports a loopback error for localhost', () => {
    const r = validateWebhookUrl('http://localhost')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Loopback addresses are not allowed')
  })

  it('rejects any 127.0.0.0/8 address', () => {
    const r = validateWebhookUrl('http://127.5.5.5/hook')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Loopback addresses are not allowed')
  })
})

describe('validateWebhookUrl — cloud metadata endpoints', () => {
  it('rejects the AWS/GCP metadata IP', () => {
    const r = validateWebhookUrl('http://169.254.169.254/latest/meta-data')
    expect(r.ok).toBe(false)
    // 169.254.169.254 matches the explicit metadata check before the
    // link-local range check, so the metadata error wins.
    if (!r.ok)
      expect(r.error).toBe('Cloud metadata endpoints are not allowed')
  })

  it('rejects metadata.google.internal', () => {
    const r = validateWebhookUrl('http://metadata.google.internal/computeMetadata')
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.error).toBe('Cloud metadata endpoints are not allowed')
  })
})

describe('validateWebhookUrl — private + reserved IPv4 ranges', () => {
  it('rejects 10.0.0.0/8', () => {
    const r = validateWebhookUrl('http://10.1.2.3/hook')
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.error).toBe('Private IP addresses (10.x.x.x) are not allowed')
  })

  it('rejects 172.16.0.0/12 boundaries', () => {
    expect(validateWebhookUrl('http://172.16.0.1/hook').ok).toBe(false)
    expect(validateWebhookUrl('http://172.31.255.255/hook').ok).toBe(false)
  })

  it('accepts 172.x outside the 16-31 private block', () => {
    expect(validateWebhookUrl('http://172.15.0.1/hook')).toEqual({ ok: true })
    expect(validateWebhookUrl('http://172.32.0.1/hook')).toEqual({ ok: true })
  })

  it('rejects 192.168.0.0/16', () => {
    const r = validateWebhookUrl('http://192.168.1.1/hook')
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.error).toBe('Private IP addresses (192.168.x.x) are not allowed')
  })

  it('accepts 192.x outside 192.168', () => {
    expect(validateWebhookUrl('http://192.167.0.1/hook')).toEqual({ ok: true })
  })

  it('rejects 169.254.x.x link-local (non-metadata)', () => {
    const r = validateWebhookUrl('http://169.254.10.10/hook')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Link-local addresses are not allowed')
  })

  it('rejects 0.0.0.0/8 (other than 0.0.0.0 loopback alias)', () => {
    const r = validateWebhookUrl('http://0.1.2.3/hook')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Invalid IP address')
  })

  it('is case-insensitive on hostnames', () => {
    expect(validateWebhookUrl('http://LOCALHOST/hook').ok).toBe(false)
  })
})
