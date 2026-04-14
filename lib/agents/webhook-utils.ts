import 'server-only'
import { createHmac } from 'crypto'

/**
 * Block SSRF: reject callbackUrls that resolve to private/internal addresses.
 * Allows only http/https on public hostnames.
 */
export function assertSafeCallbackUrl(raw: string): void {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Invalid callbackUrl')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('callbackUrl must use http or https')
  }

  const host = url.hostname.toLowerCase()

  // Block localhost and loopback
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.localhost')
  ) {
    throw new Error('callbackUrl must not point to localhost')
  }

  // Block private IPv4 ranges: 10.x, 172.16-31.x, 192.168.x
  const privateIpv4 =
    /^(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)$/
  if (privateIpv4.test(host)) {
    throw new Error('callbackUrl must not point to a private IP address')
  }

  // Block link-local and metadata endpoints
  if (host === '169.254.169.254' || host.startsWith('169.254.')) {
    throw new Error('callbackUrl must not point to a link-local address')
  }
}

/**
 * Sign the callback payload with HMAC-SHA256.
 * The receiving server can verify:
 *   HMAC-SHA256(secret, payload) === signature header
 */
export function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}
