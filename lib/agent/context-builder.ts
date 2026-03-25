import { type VibeAgent } from '@/lib/types'
import { readFullFileContent } from './file-search'
import { fetchUrlContent } from './fetch-url-content'
import { buildToolKit, type ToolExecutionContext, type ToolKit } from './tools'

const MAX_CONTEXT_CHARS = 30_000
const FILE_BUDGET_RATIO = 0.6

export interface ContextBuildResult {
  contextText: string
  toolkit: ToolKit
  sources: string[]
  hasFileOverflow: boolean
}

/**
 * Assemble agent context by pre-loading file content and source URLs.
 * Returns the context text for the system prompt and a pruned toolkit
 * (file_search is removed if all files fit in context).
 */
export async function buildAgentContext(
  agent: VibeAgent,
  toolContext?: ToolExecutionContext
): Promise<ContextBuildResult> {
  const fileBudget = Math.floor(MAX_CONTEXT_CHARS * FILE_BUDGET_RATIO)
  const parts: string[] = []
  const sources: string[] = []
  let usedChars = 0
  let hasFileOverflow = false

  // --- Phase 1: Load file content ---
  if (agent.fileKeys.length > 0) {
    const fileResults = await Promise.allSettled(
      agent.fileKeys.map(key => readFullFileContent(key))
    )

    // Collect successful reads, sorted by size (smallest first to maximize count)
    const files = fileResults
      .map((r, i) =>
        r.status === 'fulfilled' ? r.value : null
      )
      .filter((f): f is NonNullable<typeof f> => f !== null && f.charCount > 0)
      .sort((a, b) => a.charCount - b.charCount)

    for (const file of files) {
      if (usedChars + file.charCount <= fileBudget) {
        parts.push(`[File: ${file.fileName}]\n${file.text}`)
        sources.push(file.fileName)
        usedChars += file.charCount
      } else {
        hasFileOverflow = true
      }
    }
  }

  // --- Phase 2: Load source URL content ---
  const sourceUrls = (agent.sourceUrls ?? []).slice(0, 5)
  if (sourceUrls.length > 0) {
    const urlBudget = MAX_CONTEXT_CHARS - usedChars
    const urlResults = await Promise.allSettled(
      sourceUrls.map(url => fetchUrlContent(url))
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
      // URLs that don't fit can still be fetched at runtime via web_fetch tool
    }
  }

  // --- Phase 3: Build toolkit with pruning ---
  const fullToolkit = buildToolKit(agent, {
    fileContext: toolContext?.fileContext ?? null
  })

  // If all files fit in context, remove file_search from toolkit
  let toolkit = fullToolkit
  if (!hasFileOverflow && agent.fileKeys.length > 0) {
    toolkit = {
      functions: fullToolkit.functions.filter(fn => fn.name !== 'file_search'),
      executors: Object.fromEntries(
        Object.entries(fullToolkit.executors).filter(([name]) => name !== 'file_search')
      )
    }
  }

  const contextText = parts.length > 0 ? parts.join('\n\n---\n\n') : ''

  return { contextText, toolkit, sources, hasFileOverflow }
}
