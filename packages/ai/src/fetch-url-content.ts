import { JSDOM } from 'jsdom'
import net from 'node:net'

export interface UrlContentResult {
  url: string
  title?: string
  description?: string
  textContent: string
  error?: string
}

const USER_AGENT = 'Mozilla/5.0 (compatible; VibeAgent/1.0)'
const FETCH_TIMEOUT_MS = 10000
const MAX_TEXT_CHARS = 8000
const MAX_REDIRECTS = 3

const isPrivateIpv4 = (ip: string) => {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) return true
  const [a, b] = parts

  if (a === 0) return true
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  // Carrier-grade NAT
  if (a === 100 && b >= 64 && b <= 127) return true

  return false
}

const isPrivateIpv6 = (ip: string) => {
  const value = ip.toLowerCase()
  if (value === '::1') return true
  if (value.startsWith('fe80:') || value === 'fe80::') return true // link-local
  if (value.startsWith('fc') || value.startsWith('fd')) return true // unique local

  // IPv4-mapped IPv6 address
  const v4MappedPrefix = '::ffff:'
  if (value.startsWith(v4MappedPrefix)) {
    const v4 = value.slice(v4MappedPrefix.length)
    return isPrivateIpv4(v4)
  }

  return false
}

const isBlockedHost = (hostname: string) => {
  const host = hostname.trim().toLowerCase()
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '127.0.0.1' || host === '::1') return true

  const ipVersion = net.isIP(host)
  if (ipVersion === 4) {
    return isPrivateIpv4(host)
  }
  if (ipVersion === 6) {
    return isPrivateIpv6(host)
  }

  return false
}

const validateHttpUrl = (value: string) => {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { ok: false as const, error: 'Invalid URL' }
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return {
      ok: false as const,
      error: 'Only HTTP and HTTPS URLs are supported'
    }
  }

  if (isBlockedHost(parsed.hostname)) {
    return { ok: false as const, error: 'Blocked URL host' }
  }

  return { ok: true as const, url: parsed }
}

const fetchHtmlWithRedirects = async (
  initialUrl: string
): Promise<{ finalUrl: string; html: string } | { error: string }> => {
  let current = initialUrl

  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    const validated = validateHttpUrl(current)
    if (!validated.ok) {
      return { error: validated.error }
    }

    const response = await fetch(validated.url.toString(), {
      headers: {
        'User-Agent': USER_AGENT
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'manual'
    })

    // Manual redirect handling to prevent redirect-to-private SSRF
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) {
        return {
          error: `Redirect (${response.status}) without Location header`
        }
      }

      const nextUrl = new URL(location, validated.url).toString()
      current = nextUrl
      continue
    }

    if (!response.ok) {
      return {
        error: `Failed to fetch: ${response.status} ${response.statusText}`
      }
    }

    const html = await response.text()
    return { finalUrl: validated.url.toString(), html }
  }

  return { error: 'Too many redirects' }
}

/**
 * Fetches and extracts text content from a URL for AI analysis
 */
export async function fetchUrlContent(url: string): Promise<UrlContentResult> {
  try {
    const fetched = await fetchHtmlWithRedirects(url)
    if ('error' in fetched) {
      return { url, textContent: '', error: fetched.error }
    }

    const dom = new JSDOM(fetched.html)
    const document = dom.window.document

    // Extract metadata
    const title =
      document.querySelector('title')?.textContent?.trim() ||
      document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute('content') ||
      ''

    const description =
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute('content') ||
      document
        .querySelector('meta[property="og:description"]')
        ?.getAttribute('content') ||
      ''

    // Remove script, style, and other non-content elements
    const elementsToRemove = document.querySelectorAll(
      'script, style, noscript, iframe, svg, path'
    )
    elementsToRemove.forEach((el: Element) => el.remove())

    // Extract text content
    const bodyText = document.body?.textContent || ''
    const cleanedText = bodyText
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim()

    // Limit text content for AI processing
    const truncatedText =
      cleanedText.length > MAX_TEXT_CHARS
        ? `${cleanedText.substring(0, MAX_TEXT_CHARS)}...`
        : cleanedText

    return {
      url: fetched.finalUrl,
      title,
      description,
      textContent: truncatedText
    }
  } catch (error) {
    return {
      url,
      textContent: '',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  }
}
