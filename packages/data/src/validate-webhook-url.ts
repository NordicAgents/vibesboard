/** True if a literal IPv4 string is in a private/reserved/loopback range. */
function isPrivateIpv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [, a, b] = m.map(Number)
  if ([a, b].some(n => n > 255)) return false
  if (a === 0) return true // 0.0.0.0/8
  if (a === 10) return true // 10.0.0.0/8
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true // link-local / IMDS
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true // CG-NAT 100.64.0.0/10
  return false
}

/** True if a literal IPv6 string is loopback/link-local/ULA/mapped-private. */
function isPrivateIpv6(ip: string): boolean {
  const v = ip.replace(/^\[|\]$/g, '').toLowerCase()
  if (v === '::1' || v === '::') return true
  if (v.startsWith('fe80:') || v === 'fe80::') return true // link-local
  if (v.startsWith('fc') || v.startsWith('fd')) return true // unique local
  const mapped = '::ffff:'
  if (v.startsWith(mapped)) return isPrivateIpv4(v.slice(mapped.length))
  return false
}

/**
 * Validates a webhook URL to prevent SSRF attacks.
 * Blocks private/reserved IP ranges (IPv4 and IPv6), loopback, link-local,
 * CG-NAT, cloud metadata endpoints, and non-HTTP schemes.
 *
 * NOTE: this inspects the literal hostname only. It does NOT resolve DNS, so a
 * public name that resolves to a private address (or DNS rebinding) is not
 * caught here — that must be enforced at fetch time. See docs/security.md.
 */
export function validateWebhookUrl(
  url: string
): { ok: true } | { ok: false; error: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: 'Invalid URL format' }
  }

  // Only allow http and https schemes
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http and https URLs are allowed' }
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')

  // Block loopback / unspecified hostnames
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '0.0.0.0'
  ) {
    return { ok: false, error: 'Loopback addresses are not allowed' }
  }

  // Block cloud metadata endpoints
  if (
    hostname === '169.254.169.254' ||
    hostname === 'metadata.google.internal'
  ) {
    return { ok: false, error: 'Cloud metadata endpoints are not allowed' }
  }

  if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
    return {
      ok: false,
      error: 'Private, loopback, and link-local addresses are not allowed'
    }
  }

  return { ok: true }
}
