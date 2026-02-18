import { searchAgentFileChunks } from '@/lib/agent/file-search'
import { type ToolFactory, registerBuiltinTool, resolveToolDescription, resolveToolName } from './base'

const sanitizeText = (input: string, max = 2000) =>
  input
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

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
        const res = await fetch(url)
        if (!res.ok) {
          return `Failed to fetch ${url}: ${res.status} ${res.statusText}`
        }
        const text = await res.text()
        return `URL: ${url}\n${sanitizeText(text)}`
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
        'Search the public web for recent information using DuckDuckGo.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'A concise search query.'
          }
        },
        required: ['query']
      }
    },
    execute: async (args: Record<string, any>) => {
      const query = String(args?.query ?? '').trim()
      if (!query) return 'No search query provided.'
      const endpoint = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=web`
      try {
        const res = await fetch(endpoint, {
          headers: {
            'User-Agent': 'VibeAgentBot/1.0 (+https://vibeagent.app)'
          }
        })
        if (!res.ok) {
          return `Search failed (${res.status} ${res.statusText}).`
        }
        const html = await res.text()
        const text = html.replace(/<[^>]+>/g, ' ')
        return `DuckDuckGo results for "${query}":\n${sanitizeText(text)}`
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
            `File: ${entry.fileName}\nScore: ${entry.score?.toFixed?.(4) ?? '0'}\nSnippet:\n${entry.snippet}`
        )
        .join('\n---\n')

      return `Matches for "${query}":\n${formatted}`
    }
  }
}

registerBuiltinTool('builtin:web_fetch', webFetchFactory)
registerBuiltinTool('builtin:search', searchFactory)
registerBuiltinTool('builtin:file_search', fileSearchFactory)
