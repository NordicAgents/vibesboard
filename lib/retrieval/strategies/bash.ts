import { Bash } from 'just-bash'
import { readFullFileContent } from '@/lib/agent/file-search'
import { fetchUrlContent } from '@/lib/agent/fetch-url-content'
import { type RegisteredTool } from '@/lib/agent/tools/base'
import { type Retriever, type RetrieverConfig, type RetrieverResult } from '../types'

const MAX_CONTEXT_CHARS = 30_000
const MAX_OUTPUT_CHARS = 8_000

const EXECUTION_LIMITS = {
  maxCallDepth: 50,
  maxCommandCount: 500,
  maxLoopIterations: 5_000,
  maxAwkIterations: 5_000,
  maxSedIterations: 5_000
}

export class BashRetriever implements Retriever {
  private bash: Bash | null = null
  private fileNames: string[] = []

  constructor(private config: RetrieverConfig) {}

  async prepare(): Promise<void> {
    const { fileKeys } = this.config

    this.bash = new Bash({ executionLimits: EXECUTION_LIMITS })

    if (fileKeys.length === 0) return

    // Download all files and write into virtual FS at /home/user/project/
    const fileResults = await Promise.allSettled(
      fileKeys.map(key => readFullFileContent(key))
    )

    for (const result of fileResults) {
      if (result.status !== 'fulfilled') continue
      const { text, fileName } = result.value
      if (!text.trim()) continue

      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
      await this.bash.exec(`mkdir -p /home/user/project`)
      await this.bash.exec(
        `cat > /home/user/project/${safeName} << 'VIBEAGENT_EOF'\n${text}\nVIBAGENT_EOF`
      )
      this.fileNames.push(safeName)
    }
  }

  async build(): Promise<RetrieverResult> {
    const { sourceUrls = [] } = this.config
    const parts: string[] = []
    const sources: string[] = []
    let usedChars = 0

    // Still load source URLs into context
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

    // Inject a file listing hint into the system context
    let contextText = parts.length > 0 ? parts.join('\n\n---\n\n') : ''
    if (this.fileNames.length > 0) {
      const listing = this.fileNames.map(f => `  - /home/user/project/${f}`).join('\n')
      const hint = `[Uploaded files available in sandbox]\nUse the bash tool to analyze them:\n${listing}`
      contextText = contextText ? `${hint}\n\n---\n\n${contextText}` : hint
    }

    const bash = this.bash

    const bashTool: RegisteredTool = {
      function: {
        name: 'bash',
        description:
          'Run a shell command in a sandboxed virtual filesystem containing the uploaded files. ' +
          'Files are at /home/user/project/. ' +
          'Supports: grep, rg, awk, sed, head, tail, cat, sort, uniq, wc, cut, tr, jq, xan, yq, find, ls, diff. ' +
          'No network access. No writes persist after the conversation.',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The shell command to run.'
            }
          },
          required: ['command']
        }
      },
      execute: async (args: Record<string, any>) => {
        const command = String(args?.command ?? '').trim()
        if (!command) return 'No command provided.'
        if (!bash) return 'Bash sandbox not initialised.'

        try {
          const result = await bash.exec(command)
          const stdout = result.stdout?.slice(0, MAX_OUTPUT_CHARS) ?? ''
          const stderr = result.stderr?.slice(0, 500) ?? ''

          if (result.exitCode !== 0 && !stdout) {
            return `Command failed (exit ${result.exitCode})${stderr ? `: ${stderr}` : ''}`
          }

          const output = stdout || '(no output)'
          return stderr
            ? `${output}\n[stderr]: ${stderr}`
            : output
        } catch (err: any) {
          return `Error executing command: ${err?.message ?? err}`
        }
      }
    }

    return {
      contextText,
      tools: [bashTool],
      sources,
      hasOverflow: false
    }
  }

  async dispose(): Promise<void> {
    // just-bash uses an in-memory virtual FS — no real files to clean up
    this.bash = null
  }
}
