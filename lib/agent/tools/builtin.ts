import { searchAgentFileChunks } from '@/lib/agent/file-search'
import { fetchUrlContent } from '@/lib/agent/fetch-url-content'
import { type ToolFactory, registerBuiltinTool, resolveToolDescription, resolveToolName } from './base'

const sanitizeText = (input: string, max = 2000) =>
  input
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

const truncate = (input: string, max: number) => {
  const text = sanitizeText(input, max + 1)
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text
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
registerBuiltinTool('builtin:file_search', fileSearchFactory)
