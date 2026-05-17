/**
 * Validates a webhook URL to prevent SSRF attacks.
 * Blocks private/reserved IP ranges, loopback, link-local, and non-HTTP schemes.
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

  const hostname = parsed.hostname.toLowerCase()

  // Block loopback addresses
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
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

  // Block private IP ranges (RFC 1918) and other reserved ranges
  const ipv4Match = hostname.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
  )
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number)

    // 10.0.0.0/8
    if (a === 10) {
      return {
        ok: false,
        error: 'Private IP addresses (10.x.x.x) are not allowed'
      }
    }
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) {
      return {
        ok: false,
        error: 'Private IP addresses (172.16-31.x.x) are not allowed'
      }
    }
    // 192.168.0.0/16
    if (a === 192 && b === 168) {
      return {
        ok: false,
        error: 'Private IP addresses (192.168.x.x) are not allowed'
      }
    }
    // 169.254.0.0/16 (link-local)
    if (a === 169 && b === 254) {
      return { ok: false, error: 'Link-local addresses are not allowed' }
    }
    // 127.0.0.0/8
    if (a === 127) {
      return { ok: false, error: 'Loopback addresses are not allowed' }
    }
    // 0.0.0.0/8
    if (a === 0) {
      return { ok: false, error: 'Invalid IP address' }
    }
  }

  return { ok: true }
}
