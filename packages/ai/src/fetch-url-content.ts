import { JSDOM } from 'jsdom'
import {
  safeFetch,
  readCappedText,
  SsrfError
} from '@vibesboard/utils/safe-fetch'

export interface UrlContentResult {
  url: string
  title?: string
  description?: string
  textContent: string
  error?: string
}

const USER_AGENT = 'Mozilla/5.0 (compatible; Vibesboard/1.0)'
const FETCH_TIMEOUT_MS = 10000
const MAX_TEXT_CHARS = 8000
const MAX_REDIRECTS = 3
// Cap the raw HTML we read before JSDOM parses it — a hostile page could
// otherwise stream unbounded bytes (memory/CPU DoS) since truncation to
// MAX_TEXT_CHARS previously happened only after the whole document was parsed.
const MAX_HTML_BYTES = 3 * 1024 * 1024

const fetchHtmlWithRedirects = async (
  initialUrl: string
): Promise<{ finalUrl: string; html: string } | { error: string }> => {
  let response: Response
  try {
    // safeFetch DNS-resolves each hop (defeating public-name -> private-IP and
    // rebinding), follows redirects manually with re-validation, and times out.
    response = await safeFetch(
      initialUrl,
      { headers: { 'User-Agent': USER_AGENT } },
      { timeoutMs: FETCH_TIMEOUT_MS, maxRedirects: MAX_REDIRECTS }
    )
  } catch (err) {
    if (err instanceof SsrfError) return { error: err.message }
    return { error: 'Failed to fetch URL' }
  }

  if (!response.ok) {
    return {
      error: `Failed to fetch: ${response.status} ${response.statusText}`
    }
  }

  const { text: html } = await readCappedText(response, MAX_HTML_BYTES)
  return { finalUrl: response.url || initialUrl, html }
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
