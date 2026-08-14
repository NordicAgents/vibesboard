import { searchAgentFileChunks } from '@vibesboard/ai/file-search'
import { fetchUrlContent } from '@vibesboard/ai/fetch-url-content'
import { type RegisteredTool } from '@vibesboard/ai/tools/base'
import {
  type Retriever,
  type RetrieverConfig,
  type RetrieverResult
} from '../types.ts'

const MAX_CONTEXT_CHARS = 30_000

export class RagRetriever implements Retriever {
  private config: RetrieverConfig
  constructor(config: RetrieverConfig) {
    this.config = config
  }

  async prepare(): Promise<void> {}

  async build(): Promise<RetrieverResult> {
    const { agentId, tenantId, sourceUrls = [] } = this.config
    const parts: string[] = []
    const sources: string[] = []
    let usedChars = 0

    // RAG does NOT pre-load files into context — they are searched on demand.
    // But we still load source URLs.
    const urls = sourceUrls.slice(0, 5)
    if (urls.length > 0) {
      const urlResults = await Promise.allSettled(
        urls.map(url => fetchUrlContent(url))
      )

      for (const result of urlResults) {
        if (result.status !== 'fulfilled') continue
        const fetched = result.value
        if (fetched.error || !fetched.textContent) continue

        const label = fetched.title || fetched.url
        const content = fetched.textContent
        if (usedChars + content.length <= MAX_CONTEXT_CHARS) {
          parts.push(`[Source: ${label}]\nURL: ${fetched.url}\n${content}`)
          sources.push(fetched.url)
          usedChars += content.length
        }
      }
    }

    // No tool when there is nothing to search, or when the operator turned
    // File search off. This retriever used to inject file_search purely on
    // "does the agent have files", overriding the built-in toolkit by name —
    // so the Knowledge tab's switch appeared to do nothing under RAG. Source
    // URLs above are unaffected; they are context, not a file tool.
    const fileSearchEnabled = this.config.fileSearchEnabled ?? true
    if (this.config.fileKeys.length === 0 || !fileSearchEnabled) {
      return {
        contextText: parts.length > 0 ? parts.join('\n\n---\n\n') : '',
        tools: [],
        sources,
        hasOverflow: false
      }
    }

    // Provide a file_search tool that queries the RAG pipeline
    const fileSearchTool: RegisteredTool = {
      function: {
        name: 'file_search',
        description:
          'Search over the files uploaded to this agent and return matching excerpts using semantic search.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Keywords or natural language query to search within the agent files.'
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
          tenantId,
          agentId,
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
          .map(entry => `File: ${entry.fileName}\nSnippet:\n${entry.snippet}`)
          .join('\n---\n')

        return `Matches for "${query}":\n${formatted}`
      }
    }

    return {
      contextText: parts.length > 0 ? parts.join('\n\n---\n\n') : '',
      tools: [fileSearchTool],
      sources,
      hasOverflow: false
    }
  }

  async dispose(): Promise<void> {}
}
