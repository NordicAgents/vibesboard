import { JSDOM } from 'jsdom'

export interface UrlContentResult {
    url: string
    title?: string
    description?: string
    textContent: string
    error?: string
}

/**
 * Fetches and extracts text content from a URL for AI analysis
 */
export async function fetchUrlContent(url: string): Promise<UrlContentResult> {
    try {
        // Validate URL
        const parsedUrl = new URL(url)
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            return {
                url,
                textContent: '',
                error: 'Only HTTP and HTTPS URLs are supported'
            }
        }

        // Fetch the page
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; VibeAgent/1.0)'
            },
            // Timeout after 10 seconds
            signal: AbortSignal.timeout(10000)
        })

        if (!response.ok) {
            return {
                url,
                textContent: '',
                error: `Failed to fetch: ${response.status} ${response.statusText}`
            }
        }

        const html = await response.text()
        const dom = new JSDOM(html)
        const document = dom.window.document

        // Extract metadata
        const title =
            document.querySelector('title')?.textContent?.trim() ||
            document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
            ''

        const description =
            document.querySelector('meta[name="description"]')?.getAttribute('content') ||
            document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
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

        // Limit text content to approximately 8000 characters for AI processing
        const truncatedText =
            cleanedText.length > 8000
                ? cleanedText.substring(0, 8000) + '...'
                : cleanedText

        return {
            url,
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
