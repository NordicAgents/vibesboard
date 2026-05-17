import { readFullFileContent } from '@vibesboard/ai/file-search'
import { fetchUrlContent } from '@vibesboard/ai/fetch-url-content'
import {
  type Retriever,
  type RetrieverConfig,
  type RetrieverResult
} from '../types.ts'

const MAX_CONTEXT_CHARS = 30_000
const FILE_BUDGET_RATIO = 0.6

export class DirectRetriever implements Retriever {
  constructor(private config: RetrieverConfig) {}

  async prepare(): Promise<void> {}

  async build(): Promise<RetrieverResult> {
    const { fileKeys, sourceUrls = [] } = this.config
    const fileBudget = Math.floor(MAX_CONTEXT_CHARS * FILE_BUDGET_RATIO)
    const parts: string[] = []
    const sources: string[] = []
    let usedChars = 0
    let hasOverflow = false

    // --- Load file content ---
    if (fileKeys.length > 0) {
      const fileResults = await Promise.allSettled(
        fileKeys.map(key => readFullFileContent(key))
      )

      const files = fileResults
        .map(r => (r.status === 'fulfilled' ? r.value : null))
        .filter(
          (f): f is NonNullable<typeof f> => f !== null && f.charCount > 0
        )
        .sort((a, b) => a.charCount - b.charCount)

      for (const file of files) {
        if (usedChars + file.charCount <= fileBudget) {
          parts.push(`[File: ${file.fileName}]\n${file.text}`)
          sources.push(file.fileName)
          usedChars += file.charCount
        } else {
          hasOverflow = true
        }
      }
    }

    // --- Load source URL content ---
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

    return {
      contextText: parts.length > 0 ? parts.join('\n\n---\n\n') : '',
      tools: [],
      sources,
      hasOverflow
    }
  }

  async dispose(): Promise<void> {}
}
