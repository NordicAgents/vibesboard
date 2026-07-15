import { describe, it, expect } from 'vitest'
import { validateProviderBaseUrl } from '../provider-ssrf-guard.ts'

describe('validateProviderBaseUrl', () => {
  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const ok = (value: string, opts?: Parameters<typeof validateProviderBaseUrl>[1]) =>
    validateProviderBaseUrl(value, opts)

  // ---------------------------------------------------------------------------
  // Return shape
  // ---------------------------------------------------------------------------
  describe('return shape', () => {
    it('ok:true result has no error property', () => {
      const result = ok('https://api.openai.com/v1')
      expect(result.ok).toBe(true)
      expect(result).not.toHaveProperty('error')
    })

    it('ok:false result has an error string', () => {
      const result = ok('http://localhost/api')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(typeof result.error).toBe('string')
        expect(result.error.length).toBeGreaterThan(0)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Blocked by default — private IPv4 ranges
  // ---------------------------------------------------------------------------
  describe('blocks private IPv4 by default', () => {
    it('blocks 10.x.x.x (Class A private)', () => {
      expect(ok('http://10.0.0.1/api').ok).toBe(false)
    })

    it('blocks 172.16.x.x (Class B private lower bound)', () => {
      expect(ok('http://172.16.0.1/api').ok).toBe(false)
    })

    it('blocks 172.31.255.255 (Class B private upper bound)', () => {
      expect(ok('http://172.31.255.255/api').ok).toBe(false)
    })

    it('blocks 192.168.x.x (Class C private)', () => {
      expect(ok('http://192.168.1.1/api').ok).toBe(false)
    })

    it('blocks 127.0.0.1 (loopback)', () => {
      expect(ok('http://127.0.0.1/api').ok).toBe(false)
    })

    it('blocks 127.255.255.255 (loopback range end)', () => {
      expect(ok('http://127.255.255.255/api').ok).toBe(false)
    })

    it('blocks 169.254.169.254 (AWS/GCP IMDS)', () => {
      expect(ok('http://169.254.169.254/latest/meta-data').ok).toBe(false)
    })

    it('blocks 0.0.0.0', () => {
      expect(ok('http://0.0.0.0/api').ok).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Blocked by default — localhost variants
  // ---------------------------------------------------------------------------
  describe('blocks localhost variants by default', () => {
    it('blocks http://localhost/api', () => {
      expect(ok('http://localhost/api').ok).toBe(false)
    })

    it('blocks http://localhost:11434 (Ollama default port)', () => {
      expect(ok('http://localhost:11434').ok).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Blocked by default — non-http/https schemes
  // ---------------------------------------------------------------------------
  describe('blocks non-http/https schemes', () => {
    it('blocks ftp://', () => {
      const result = ok('ftp://example.com')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/http/i)
      }
    })

    it('blocks file:///', () => {
      expect(ok('file:///etc/passwd').ok).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Blocked by default — malformed / non-URL strings
  // ---------------------------------------------------------------------------
  describe('rejects malformed or non-URL input', () => {
    it('rejects "not-a-url"', () => {
      const result = ok('not-a-url')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Invalid URL')
      }
    })

    it('rejects empty string', () => {
      const result = ok('')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Invalid URL')
      }
    })

    it('rejects whitespace-only string', () => {
      const result = ok('   ')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Invalid URL')
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Allowed by default — public URLs
  // ---------------------------------------------------------------------------
  describe('allows public URLs by default', () => {
    it('allows https://api.openai.com/v1', () => {
      expect(ok('https://api.openai.com/v1').ok).toBe(true)
    })

    it('allows https://api.anthropic.com', () => {
      expect(ok('https://api.anthropic.com').ok).toBe(true)
    })

    it('allows https://generativelanguage.googleapis.com', () => {
      expect(ok('https://generativelanguage.googleapis.com').ok).toBe(true)
    })

    it('allows http://example.com:8080/api', () => {
      expect(ok('http://example.com:8080/api').ok).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // allowPrivateHosts flag
  // ---------------------------------------------------------------------------
  describe('allowPrivateHosts option', () => {
    it('allows http://localhost:11434 when allowPrivateHosts: true', () => {
      expect(ok('http://localhost:11434', { allowPrivateHosts: true }).ok).toBe(true)
    })

    it('allows 192.168.1.100 when allowPrivateHosts: true', () => {
      expect(ok('http://192.168.1.100/api', { allowPrivateHosts: true }).ok).toBe(true)
    })

    it('still blocks non-http scheme even with allowPrivateHosts: true', () => {
      expect(ok('ftp://localhost', { allowPrivateHosts: true }).ok).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // hostAllowlist option
  // ---------------------------------------------------------------------------
  describe('hostAllowlist option', () => {
    it('allows a private host that is in the allowlist (without allowPrivateHosts)', () => {
      expect(
        ok('http://localhost:11434', { hostAllowlist: ['localhost'] }).ok,
      ).toBe(true)
    })

    it('matches allowlist entries case-insensitively (LOCALHOST vs localhost)', () => {
      expect(
        ok('http://localhost:11434', { hostAllowlist: ['LOCALHOST'] }).ok,
      ).toBe(true)
    })

    it('still blocks a private host NOT in the allowlist', () => {
      expect(
        ok('http://192.168.1.1/api', { hostAllowlist: ['localhost'] }).ok,
      ).toBe(false)
    })

    it('allows an explicitly allowlisted IP', () => {
      expect(
        ok('http://10.0.0.5/api', { hostAllowlist: ['10.0.0.5'] }).ok,
      ).toBe(true)
    })
  })
})
