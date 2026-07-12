/**
 * SSRF guard for tenant-supplied provider baseUrl values.
 *
 * Tenant admins can configure `openai_compatible` providers with a custom
 * baseUrl. Without validation the server would make outbound HTTP requests
 * to any URL including private ranges (IMDS, internal services, localhost).
 *
 * Apply at:
 *   1. API route validation (reject on save — best UX)
 *   2. createEmbedding / buildProviderModel (defense-in-depth at fetch time)
 */

import net from 'node:net'

const isPrivateIpv4 = (ip: string): boolean => {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) return true
  const [a, b] = parts
  if (a === 0) return true
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true   // link-local / IMDS
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true  // CG-NAT
  return false
}

const isPrivateIpv6 = (ip: string): boolean => {
  const v = ip.toLowerCase()
  if (v === '::1') return true
  if (v.startsWith('fe80:') || v === 'fe80::') return true
  if (v.startsWith('fc') || v.startsWith('fd')) return true
  const v4mapped = '::ffff:'
  if (v.startsWith(v4mapped)) return isPrivateIpv4(v.slice(v4mapped.length))
  return false
}

const isBlockedHost = (hostname: string): boolean => {
  const host = hostname.trim().toLowerCase()
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '127.0.0.1' || host === '::1') return true
  const ipv = net.isIP(host)
  if (ipv === 4) return isPrivateIpv4(host)
  if (ipv === 6) return isPrivateIpv6(host)
  return false
}

export interface SsrfGuardOptions {
  /** When true, private/loopback/link-local hosts are permitted (on-prem/local models). */
  allowPrivateHosts?: boolean
  /** Explicit hostname allowlist — these hosts bypass the private-IP check regardless of allowPrivateHosts. */
  hostAllowlist?: string[]
}

/**
 * Validate a tenant-supplied provider baseUrl.
 * Returns `{ ok: true }` or `{ ok: false, error: string }`.
 * Rejects non-http/https schemes and private/loopback/link-local hosts,
 * unless the tenant has opted in via allowPrivateHosts or hostAllowlist.
 */
export function validateProviderBaseUrl(
  value: string,
  opts: SsrfGuardOptions = {},
): { ok: true } | { ok: false; error: string } {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { ok: false, error: 'Invalid URL' }
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: 'Only HTTP and HTTPS base URLs are supported' }
  }

  const hostname = parsed.hostname.toLowerCase()

  // Allowlist — specific hosts always permitted regardless of private-IP rules
  if (opts.hostAllowlist?.some(h => h.toLowerCase() === hostname)) {
    return { ok: true }
  }

  // Per-tenant flag — allow all private/loopback/link-local hosts
  if (opts.allowPrivateHosts) {
    return { ok: true }
  }

  if (isBlockedHost(hostname)) {
    return {
      ok: false,
      error:
        'Private, loopback, and link-local addresses are not allowed. ' +
        'Enable "Allow private hosts" or add the host to the allowlist in Settings → LLM Providers.',
    }
  }

  return { ok: true }
}
