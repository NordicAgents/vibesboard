import { JSDOM } from 'jsdom'
import { searchAgentFileChunks } from '@/lib/agent/file-search'
import { fetchUrlContent } from '@/lib/agent/fetch-url-content'
import { type ToolFactory, registerBuiltinTool, resolveToolDescription, resolveToolName } from './base'

const sanitizeText = (input: string, max = 2000) =>
  input
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const truncate = (input: string, max: number) => {
  const text = sanitizeText(input, max + 1)
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text
}

const resolveDuckDuckGoResultUrl = (rawHref: string): string => {
  const href = rawHref.trim()
  if (!href) return ''

  const normalized = href.startsWith('//') ? `https:${href}` : href

  try {
    const parsed = new URL(normalized)
    if (parsed.hostname.endsWith('duckduckgo.com')) {
      const uddg = parsed.searchParams.get('uddg')
      if (uddg) {
        try {
          return decodeURIComponent(uddg)
        } catch {
          return uddg
        }
      }
    }
    return parsed.toString()
  } catch {
    return normalized
  }
}

const webFetchFactory: ToolFactory = ({ tool }) => {
  const name = resolveToolName(tool, 'web_fetch')
  return {
    function: {
      name,
      description: resolveToolDescription(tool),
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The absolute URL (including protocol) to fetch.',
            format: 'uri'
          }
        },
        required: ['url']
      }
    },
    execute: async (args: Record<string, any>) => {
      const url = String(args?.url ?? '').trim()
      if (!url) return 'No URL provided.'
      try {
        const result = await fetchUrlContent(url)
        if (result.error) {
          return `Error fetching ${url}: ${result.error}`
        }

        const lines: string[] = [`URL: ${result.url}`]
        if (result.title) {
          lines.push(`Title: ${truncate(result.title, 200)}`)
        }
        if (result.description) {
          lines.push(`Description: ${truncate(result.description, 300)}`)
        }
        lines.push('Content:')
        lines.push(result.textContent)
        return lines.join('\n')
      } catch (error) {
        return `Error fetching ${url}: ${error}`
      }
    }
  }
}

const searchFactory: ToolFactory = ({ tool }) => {
  const name = resolveToolName(tool, 'web_search')
  return {
    function: {
      name,
      description:
        tool.description ||
        'Search the public web for recent information using DuckDuckGo Lite.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'A concise search query.'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default 5).'
          }
        },
        required: ['query']
      }
    },
    execute: async (args: Record<string, any>) => {
      const query = String(args?.query ?? '').trim()
      if (!query) return 'No search query provided.'
      const limit = clamp(
        Number.isFinite(args?.limit) ? Number(args.limit) : 5,
        1,
        8
      )
      const endpoint = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`
      try {
        const res = await fetch(endpoint, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; VibeAgent/1.0)'
          },
          signal: AbortSignal.timeout(10000)
        })
        if (!res.ok) {
          return `Search failed (${res.status} ${res.statusText}).`
        }
        const html = await res.text()
        const dom = new JSDOM(html)
        const doc = dom.window.document

        const anchors = Array.from(doc.querySelectorAll('a.result-link'))
        if (!anchors.length) {
          return `No results found for "${query}".`
        }

        const results: Array<{ title: string; url: string; snippet: string }> =
          []
        const seenUrls = new Set<string>()

        for (const anchor of anchors) {
          if (results.length >= limit) break

          const title = truncate(anchor.textContent ?? '', 120)
          const href = (anchor as HTMLAnchorElement).getAttribute('href') ?? ''
          const resolvedUrl = resolveDuckDuckGoResultUrl(href)

          if (!resolvedUrl || seenUrls.has(resolvedUrl)) continue

          const tr = anchor.closest('tr')
          const snippetCell = tr?.nextElementSibling?.querySelector(
            'td.result-snippet'
          )
          const snippet = truncate(snippetCell?.textContent ?? '', 280)

          seenUrls.add(resolvedUrl)
          results.push({
            title: title || resolvedUrl,
            url: resolvedUrl,
            snippet
          })
        }

        const lines: string[] = [
          `DuckDuckGo Lite search results for "${query}":`
        ]

        results.forEach((result, idx) => {
          lines.push(
            `${idx + 1}) ${result.title}`,
            `URL: ${result.url}`,
            `Snippet: ${result.snippet || '(no snippet)'}`,
            ''
          )
        })

        return lines.join('\n').trim()
      } catch (error) {
        return `Search error: ${error}`
      }
    }
  }
}

const fileSearchFactory: ToolFactory = ({ agent, tool }) => {
  const name = resolveToolName(tool, 'file_search')
  return {
    function: {
      name,
      description:
        tool.description ||
        'Search over the files uploaded to this agent and return matching excerpts.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Keywords to search for within the agent files.'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of matches to return (default 8).'
          }
        },
        required: ['query']
      }
    },
    execute: async (args: Record<string, any>) => {
      const query = String(args?.query ?? '').trim()
      const limit = Number.isFinite(args?.limit) ? Number(args.limit) : 8

      if (!query) {
        return 'Please provide a search query to look up within the files.'
      }

      const { matches, error } = await searchAgentFileChunks({
        tenantId: agent.tenantId!,
        agentId: agent.id,
        query,
        limit
      })

      if (error && (!matches || matches.length === 0)) {
        return `File search error: ${error}`
      }

      if (!matches?.length) {
        return `No results found for "${query}".`
      }

      const formatted = matches
        .map(
          entry =>
            `File: ${entry.fileName}\nSnippet:\n${entry.snippet}`
        )
        .join('\n---\n')

      return `Matches for "${query}":\n${formatted}`
    }
  }
}

registerBuiltinTool('builtin:web_fetch', webFetchFactory)
registerBuiltinTool('builtin:search', searchFactory)
registerBuiltinTool('builtin:file_search', fileSearchFactory)
