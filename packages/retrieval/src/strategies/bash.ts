import { Bash } from 'just-bash'
import { readFullFileContent } from '@vibesboard/ai/file-search'
import { fetchUrlContent } from '@vibesboard/ai/fetch-url-content'
import { type RegisteredTool } from '@vibesboard/ai/tools/base'
import {
  type Retriever,
  type RetrieverConfig,
  type RetrieverResult
} from '../types.ts'

const MAX_CONTEXT_CHARS = 30_000
const MAX_OUTPUT_CHARS = 8_000
const MAX_COMMAND_LENGTH = 4_000
const MAX_FILE_CHARS = 200_000 // ~200k chars per file in virtual FS
const EXEC_TIMEOUT_MS = 10_000

const EXECUTION_LIMITS = {
  maxCallDepth: 50,
  maxCommandCount: 500,
  maxLoopIterations: 5_000,
  maxAwkIterations: 5_000,
  maxSedIterations: 5_000
}

const PROJECT_DIR = '/home/user/project'

/**
 * Sanitise a filename so it is safe to use as a path segment.
 * - Keeps alphanumeric, dots, dashes, underscores
 * - Strips leading dots (prevents hidden files and path traversal via ..)
 * - Collapses consecutive dots (prevents ..)
 * - Falls back to 'file' if nothing remains
 */
function sanitiseFileName(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9._-]/g, '_') // allowlist safe chars
      .replace(/\.{2,}/g, '.') // collapse .. → .
      .replace(/^\.+/, '') || // strip leading dots
    'file'
  )
}

/**
 * Run bash.exec with a hard timeout so a slow virtual-FS operation
 * cannot block the request indefinitely.
 */
async function execWithTimeout(
  bash: Bash,
  command: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return Promise.race([
    bash.exec(command),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Command timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    )
  ])
}

export class BashRetriever implements Retriever {
  private bash: Bash | null = null
  private fileNames: string[] = []

  constructor(private config: RetrieverConfig) {}

  async prepare(): Promise<void> {
    const { fileKeys } = this.config

    if (fileKeys.length === 0) return

    this.bash = new Bash({ executionLimits: EXECUTION_LIMITS })

    if (fileKeys.length === 0) return

    // Create project dir once via FS API (no shell invocation)
    this.bash.fs.mkdir(PROJECT_DIR)

    // Download all files in parallel then write into virtual FS directly
    // Using fs.writeFile avoids shell heredocs entirely — no injection surface
    const fileResults = await Promise.allSettled(
      fileKeys.map(key => readFullFileContent(key))
    )

    for (const result of fileResults) {
      if (result.status !== 'fulfilled') continue
      const { text, fileName } = result.value
      if (!text.trim()) continue

      const safeName = sanitiseFileName(fileName)
      // Truncate file content to prevent unbounded memory use in virtual FS
      const content =
        text.length > MAX_FILE_CHARS ? text.slice(0, MAX_FILE_CHARS) : text

      this.bash.fs.writeFile(`${PROJECT_DIR}/${safeName}`, content)
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

    // If no files were loaded, skip the bash tool entirely
    if (!this.bash) {
      return {
        contextText: parts.length > 0 ? parts.join('\n\n---\n\n') : '',
        tools: [],
        sources,
        hasOverflow: false
      }
    }

    // Inject a file listing hint into the system context
    let contextText = parts.length > 0 ? parts.join('\n\n---\n\n') : ''
    if (this.fileNames.length > 0) {
      const listing = this.fileNames
        .map(f => `  - ${PROJECT_DIR}/${f}`)
        .join('\n')
      const hint =
        `[Uploaded files are available in a sandboxed virtual filesystem]\n` +
        `Use the bash tool to read and analyze them. Files written during bash calls ` +
        `are available to subsequent bash calls within this session.\n` +
        `Available files:\n${listing}`
      contextText = contextText ? `${hint}\n\n---\n\n${contextText}` : hint
    }

    const bash = this.bash

    const bashTool: RegisteredTool = {
      function: {
        name: 'bash',
        description:
          'Run a shell command in a sandboxed virtual filesystem containing the uploaded files. ' +
          `Files are at ${PROJECT_DIR}/. ` +
          'Supports: grep, rg, awk, sed, head, tail, cat, sort, uniq, wc, cut, tr, jq, xan, yq, find, ls, diff. ' +
          'No network access. No access to the host filesystem. ' +
          'Files written during bash calls are available to subsequent bash calls within this session.',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: `The shell command to run. Maximum ${MAX_COMMAND_LENGTH} characters.`
            }
          },
          required: ['command']
        }
      },
      execute: async (args: Record<string, any>) => {
        const raw = String(args?.command ?? '').trim()
        if (!raw) return 'No command provided.'
        if (!bash) return 'Bash sandbox not initialised.'

        // Cap command length to prevent parser abuse
        const command =
          raw.length > MAX_COMMAND_LENGTH
            ? raw.slice(0, MAX_COMMAND_LENGTH)
            : raw

        try {
          const result = await execWithTimeout(bash, command, EXEC_TIMEOUT_MS)
          const stdout = (result.stdout ?? '').slice(0, MAX_OUTPUT_CHARS)
          const stderr = (result.stderr ?? '').slice(0, 500)

          if (result.exitCode !== 0 && !stdout) {
            return `Command failed (exit ${result.exitCode})${stderr ? `: ${stderr}` : ''}`
          }

          const output = stdout || '(no output)'
          return stderr ? `${output}\n[stderr]: ${stderr}` : output
        } catch (err: any) {
          return `Error: ${err?.message ?? String(err)}`
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
    // just-bash uses an in-memory virtual FS — no host files to clean up
    this.bash = null
  }
}
