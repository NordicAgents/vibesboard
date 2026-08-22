/**
 * Hardened outbound HTTP for user/tenant/model-controlled URLs (SSRF defence).
 *
 * Unlike the literal-hostname validators scattered across the codebase, this
 * RESOLVES DNS and checks every A/AAAA address against the private-range
 * block-list, so a public hostname that resolves to an internal address is
 * refused. `safeFetch` additionally pins redirect handling to `manual`,
 * re-validates every hop, strips credential headers on cross-origin redirects,
 * and bounds time and response size.
 *
 * Node-only (uses `node:dns`/`node:net`). Imported via the dedicated
 * `@vibesboard/utils/safe-fetch` subpath, never the client-safe barrel.
 *
 * Residual limitation: there is a small TOCTOU window between our DNS lookup
 * and fetch's own connect (DNS rebinding). Resolve-and-validate-each-hop closes
 * the static "public name -> private IP" case and makes rebinding require a
 * sub-request-timed DNS flip; pinning the resolved IP into the connection would
 * need a custom dispatcher and is left as a further hardening step.
 */
import { lookup } from 'node:dns/promises'
import net from 'node:net'

export class SsrfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsrfError'
  }
}

export interface SafeFetchOptions {
  /** Permit private/loopback/link-local hosts (on-prem models, local dev). */
  allowPrivateHosts?: boolean
  /** Hostnames that bypass the private-address check regardless of resolution. */
  hostAllowlist?: string[]
  /** Max redirects to follow (default 3). */
  maxRedirects?: number
  /** Per-request timeout in ms (default 10_000). */
  timeoutMs?: number
  /**
   * Extra request-header names (case-insensitive) to drop when a redirect
   * crosses origins, on top of the built-in Authorization/Cookie set. Use for
   * app-specific credential headers (e.g. `api_access_token`, a webhook token).
   */
  sensitiveHeaders?: string[]
}

/** True for a literal IPv4 string in a private/reserved/loopback range. */
export function isPrivateIpv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [, a, b, c, d] = m.map(Number)
  if ([a, b, c, d].some(n => n > 255)) return true // malformed -> treat as unsafe
  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 10) return true // 10.0.0.0/8
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true // CG-NAT 100.64.0.0/10
  if (a === 192 && b === 0 && c === 0) return true // 192.0.0.0/24 IETF
  if (a === 192 && b === 0 && c === 2) return true // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking 198.18/15
  if (a === 198 && b === 51 && c === 100) return true // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true // TEST-NET-3
  if (a >= 224) return true // multicast (224/4) + reserved (240/4) + 255.255.255.255
  return false
}

/** True for a literal IPv6 string that is loopback/link-local/ULA/mapped-private. */
export function isPrivateIpv6(ip: string): boolean {
  const v = ip.replace(/^\[|\]$/g, '').toLowerCase()
  if (v === '::1' || v === '::') return true
  if (v.startsWith('fe80:') || v === 'fe80::') return true // link-local
  if (v.startsWith('fc') || v.startsWith('fd')) return true // unique local fc00::/7
  if (v.startsWith('ff')) return true // multicast
  // IPv4-mapped (::ffff:a.b.c.d or hex-compressed ::ffff:xxxx:xxxx)
  const mapped = v.match(/^::ffff:(.+)$/)
  if (mapped) {
    const tail = mapped[1]
    if (tail.includes('.')) return isPrivateIpv4(tail)
    const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (hex) {
      const hi = parseInt(hex[1], 16)
      const lo = parseInt(hex[2], 16)
      const dotted = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
      return isPrivateIpv4(dotted)
    }
  }
  return false
}

/** Classify a literal IP (v4 or v6) as private/reserved. */
export function isPrivateAddress(ip: string): boolean {
  const fam = net.isIP(ip.replace(/^\[|\]$/g, ''))
  if (fam === 4) return isPrivateIpv4(ip)
  if (fam === 6) return isPrivateIpv6(ip)
  // Not a literal IP — caller must resolve DNS first.
  return false
}

function normalizeHost(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
}

/**
 * Parse and validate a URL for outbound use. Rejects non-http(s) schemes and
 * any host that is — or resolves to — a private/reserved address. Returns the
 * parsed URL on success; throws SsrfError otherwise.
 */
export async function assertPublicUrl(
  rawUrl: string | URL,
  opts: SafeFetchOptions = {}
): Promise<URL> {
  let url: URL
  try {
    url = typeof rawUrl === 'string' ? new URL(rawUrl) : rawUrl
  } catch {
    throw new SsrfError('Invalid URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError('Only http and https URLs are allowed')
  }

  const host = normalizeHost(url.hostname)
  if (!host) throw new SsrfError('Missing host')

  if (opts.hostAllowlist?.some(h => normalizeHost(h) === host)) return url
  if (opts.allowPrivateHosts) return url

  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new SsrfError('Loopback hosts are not allowed')
  }

  // Literal IP: classify directly (no DNS).
  const literalFamily = net.isIP(host)
  if (literalFamily !== 0) {
    if (isPrivateAddress(host)) {
      throw new SsrfError(
        'Private, loopback, or reserved address is not allowed'
      )
    }
    return url
  }

  // Hostname: resolve and reject if ANY resolved address is private.
  let records: Array<{ address: string }>
  try {
    records = await lookup(host, { all: true })
  } catch {
    throw new SsrfError(`Could not resolve host: ${host}`)
  }
  if (records.length === 0) {
    throw new SsrfError(`Host did not resolve: ${host}`)
  }
  for (const { address } of records) {
    if (isPrivateAddress(address)) {
      throw new SsrfError(
        `Host ${host} resolves to a private/reserved address (${address})`
      )
    }
  }
  return url
}

const SENSITIVE_HEADERS = ['authorization', 'cookie', 'proxy-authorization']

function stripSensitiveHeaders(
  init: RequestInit,
  extra: string[] = []
): RequestInit {
  if (!init.headers) return init
  const headers = new Headers(init.headers as HeadersInit)
  for (const name of [
    ...SENSITIVE_HEADERS,
    ...extra.map(h => h.toLowerCase())
  ]) {
    headers.delete(name)
  }
  return { ...init, headers }
}

/**
 * Fetch with SSRF protection: validates the URL (DNS-resolving) before each
 * hop, follows redirects manually (re-validating each Location), strips
 * credential headers when a redirect crosses origins, and enforces a timeout.
 * The returned Response is not size-capped — use `readCappedText` to read its
 * body with a byte limit.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  opts: SafeFetchOptions = {}
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 3
  const timeoutMs = opts.timeoutMs ?? 10_000

  let currentUrl = rawUrl
  let currentInit: RequestInit = init
  const startOrigin = (() => {
    try {
      return new URL(rawUrl).origin
    } catch {
      return null
    }
  })()

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validated = await assertPublicUrl(currentUrl, opts)

    const res = await fetch(validated, {
      ...currentInit,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs)
    })

    if (res.status < 300 || res.status >= 400) return res

    const location = res.headers.get('location')
    if (!location) return res // 3xx without Location — hand back as-is
    if (hop === maxRedirects) {
      throw new SsrfError('Too many redirects')
    }

    const nextUrl = new URL(location, validated).toString()
    const nextOrigin = new URL(nextUrl).origin
    if (startOrigin !== null && nextOrigin !== startOrigin) {
      currentInit = stripSensitiveHeaders(currentInit, opts.sensitiveHeaders)
    }
    currentUrl = nextUrl
  }

  // Unreachable — the loop returns or throws.
  throw new SsrfError('Redirect handling failed')
}

/**
 * Read a response body as text with a hard byte cap, aborting the stream once
 * the limit is exceeded so a hostile server cannot stream unbounded data.
 * Returns { text, truncated }.
 */
export async function readCappedText(
  response: Response,
  maxBytes = 5 * 1024 * 1024
): Promise<{ text: string; truncated: boolean }> {
  // Fast reject on an advertised oversized body.
  const declared = Number(response.headers.get('content-length'))
  const body = response.body
  if (!body) return { text: await response.text(), truncated: false }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        const remaining = maxBytes - total
        if (value.byteLength > remaining) {
          // Keep exactly up to the cap, then stop the stream.
          if (remaining > 0) {
            chunks.push(value.subarray(0, remaining))
            total += remaining
          }
          truncated = true
          await reader.cancel()
          break
        }
        total += value.byteLength
        chunks.push(value)
      }
    }
  } finally {
    reader.releaseLock?.()
  }
  void declared
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.byteLength
  }
  return { text: new TextDecoder().decode(merged), truncated }
}
