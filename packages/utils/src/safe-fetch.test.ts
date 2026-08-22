import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  assertPublicUrl,
  isPrivateIpv4,
  isPrivateIpv6,
  isPrivateAddress,
  safeFetch,
  readCappedText,
  SsrfError
} from './safe-fetch.ts'

// DNS is mocked so tests are deterministic and offline.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn()
}))
import { lookup } from 'node:dns/promises'
const lookupMock = vi.mocked(lookup)

afterEach(() => {
  vi.restoreAllMocks()
  lookupMock.mockReset()
})

describe('isPrivateIpv4', () => {
  it('flags private / reserved ranges', () => {
    for (const ip of [
      '0.0.0.0',
      '10.1.2.3',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255'
    ]) {
      expect(isPrivateIpv4(ip)).toBe(true)
    }
  })
  it('allows normal public addresses', () => {
    for (const ip of [
      '1.1.1.1',
      '8.8.8.8',
      '172.15.0.1',
      '172.32.0.1',
      '100.63.0.1'
    ]) {
      expect(isPrivateIpv4(ip)).toBe(false)
    }
  })
})

describe('isPrivateIpv6', () => {
  it('flags loopback, link-local, ULA, mapped-private', () => {
    for (const ip of [
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1'
    ]) {
      expect(isPrivateIpv6(ip)).toBe(true)
    }
  })
  it('allows a public IPv6 and a public v4-mapped', () => {
    expect(isPrivateIpv6('2606:4700:4700::1111')).toBe(false)
    expect(isPrivateIpv6('::ffff:8.8.8.8')).toBe(false)
  })
})

describe('isPrivateAddress', () => {
  it('handles bracketed IPv6 and non-IP input', () => {
    expect(isPrivateAddress('[::1]')).toBe(true)
    expect(isPrivateAddress('example.com')).toBe(false) // not a literal IP
  })
})

describe('assertPublicUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(assertPublicUrl('ftp://example.com')).rejects.toBeInstanceOf(
      SsrfError
    )
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toBeInstanceOf(
      SsrfError
    )
  })

  it('rejects a literal private IP without resolving', async () => {
    await expect(
      assertPublicUrl('http://169.254.169.254/latest')
    ).rejects.toThrow(/private/i)
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('rejects localhost and *.localhost', async () => {
    await expect(assertPublicUrl('http://localhost/x')).rejects.toBeInstanceOf(
      SsrfError
    )
    await expect(
      assertPublicUrl('http://foo.localhost/x')
    ).rejects.toBeInstanceOf(SsrfError)
  })

  it('rejects a public hostname that resolves to a private address (rebinding)', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as never)
    await expect(assertPublicUrl('http://evil.example.com/x')).rejects.toThrow(
      /private\/reserved/i
    )
  })

  it('rejects when ANY resolved address is private', async () => {
    lookupMock.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 }
    ] as never)
    await expect(assertPublicUrl('http://mixed.example.com')).rejects.toThrow(
      /private/i
    )
  })

  it('accepts a hostname that resolves only to public addresses', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 }
    ] as never)
    const url = await assertPublicUrl('https://example.com/path')
    expect(url.hostname).toBe('example.com')
  })

  it('honors allowPrivateHosts and hostAllowlist', async () => {
    await expect(
      assertPublicUrl('http://127.0.0.1:1234', { allowPrivateHosts: true })
    ).resolves.toBeInstanceOf(URL)
    await expect(
      assertPublicUrl('http://internal.svc', {
        hostAllowlist: ['internal.svc']
      })
    ).resolves.toBeInstanceOf(URL)
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('rejects a host that fails to resolve', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'))
    await expect(assertPublicUrl('http://nope.invalid')).rejects.toThrow(
      /resolve/i
    )
  })
})

describe('safeFetch', () => {
  it('validates before fetching and passes redirect:manual', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 }
    ] as never)
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }))
    const res = await safeFetch('https://example.com')
    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect((fetchSpy.mock.calls[0][1] as RequestInit).redirect).toBe('manual')
  })

  it('re-validates the redirect target and strips auth on cross-origin hop', async () => {
    // First host public; redirect target resolves to a private IP -> refused.
    lookupMock.mockImplementation(async (host: string) => {
      if (host === 'start.example.com')
        return [{ address: '93.184.216.34', family: 4 }] as never
      return [{ address: '169.254.169.254', family: 4 }] as never
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://internal.example.net/' }
      })
    )
    await expect(
      safeFetch('https://start.example.com', {
        headers: { authorization: 'Bearer secret' }
      })
    ).rejects.toThrow(/private/i)
  })

  it('rejects after exceeding maxRedirects', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 }
    ] as never)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/next' }
      })
    )
    await expect(
      safeFetch('https://example.com', {}, { maxRedirects: 2 })
    ).rejects.toThrow(/too many redirects/i)
  })
})

describe('readCappedText', () => {
  it('returns full body under the cap', async () => {
    const res = new Response('hello world')
    const { text, truncated } = await readCappedText(res, 1024)
    expect(text).toBe('hello world')
    expect(truncated).toBe(false)
  })

  it('truncates a body over the cap', async () => {
    const big = 'x'.repeat(10_000)
    const res = new Response(big)
    const { text, truncated } = await readCappedText(res, 100)
    expect(truncated).toBe(true)
    expect(text.length).toBeLessThanOrEqual(10_000)
    expect(text.length).toBeGreaterThan(0)
  })
})
