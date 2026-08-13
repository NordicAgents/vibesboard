/**
 * File Processor Service
 * Handles automatic background processing of uploaded files for RAG
 */

import { ingestFileForAgent } from '@vibesboard/ai/file-search'
import {
  setFileStatus,
  getFileById,
  getPendingFiles as getPendingFilesFromStore,
  type FileRecord
} from '@vibesboard/ai/files-store'

export interface ProcessFileOptions {
  fileId: string
  agentId: string
  tenantId: string
  fileKey: string
  fileName: string
  mimeType: string
}

export interface ProcessFileResult {
  success: boolean
  fileId: string
  chunksCreated: number
  tokensProcessed: number
  error?: string
}

/**
 * Process a single file: extract text -> chunk -> embed -> store
 */
export async function processFile(
  options: ProcessFileOptions
): Promise<ProcessFileResult> {
  const { fileId, agentId, tenantId, fileKey, fileName, mimeType } = options

  try {
    // 1. Mark file as processing
    await setFileStatus(fileId, 'processing')

    console.log(`[FileProcessor] Processing file: ${fileName} (${fileId})`)

    // 2. Use existing ingestion logic (extract -> chunk -> embed -> write Postgres)
    const result = await ingestFileForAgent({
      tenantId,
      agentId,
      fileId,
      fileKey,
      fileName,
      mimeType
    })

    // 3. A zero-chunk ingest is a failure, not a success. ingestFileForAgent
    //    early-returns `{ chunksInserted: 0, message }` when the file has no
    //    extractable text, when embed() throws (expired API key, quota) or when
    //    the provider returns no embeddings — and on those paths it never writes
    //    status/embeddingProvider itself. Falling through to 'indexed' would show
    //    the user a healthy knowledge file the agent knows nothing about, leave
    //    embedding_provider NULL (the stale-embedding detector skips NULL), and
    //    throw away the actionable message ("API key may be expired", "quota
    //    exceeded") that ingestFileForAgent built for exactly this case.
    if (!result.chunksInserted) {
      const reason =
        result.message || 'Ingestion produced no searchable chunks.'

      console.error(
        `[FileProcessor] Ingestion produced no chunks for ${fileName}:`,
        reason
      )

      await setFileStatus(fileId, 'failed', { error: reason })

      return {
        success: false,
        fileId,
        chunksCreated: 0,
        tokensProcessed: 0,
        error: reason
      }
    }

    // 4. Estimate token count (approximate: 1 token ~ 4 chars)
    const estimatedTokens = result.totalChars
      ? Math.ceil(result.totalChars / 4)
      : Math.ceil((result.chunksInserted * 1200) / 4)

    // 5. Mark file as indexed
    await setFileStatus(fileId, 'indexed')

    console.log(
      `[FileProcessor] Successfully processed: ${fileName} ` +
        `(${result.chunksInserted} chunks, ~${estimatedTokens} tokens)`
    )

    return {
      success: true,
      fileId,
      chunksCreated: result.chunksInserted,
      tokensProcessed: estimatedTokens
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    console.error(
      `[FileProcessor] Failed to process ${fileName}:`,
      errorMessage
    )

    await setFileStatus(fileId, 'failed', { error: errorMessage })

    return {
      success: false,
      fileId,
      chunksCreated: 0,
      tokensProcessed: 0,
      error: errorMessage
    }
  }
}

/**
 * Process multiple files in batch (up to 5 concurrent)
 */
export async function processBatch(
  files: ProcessFileOptions[],
  concurrency = 5
): Promise<ProcessFileResult[]> {
  const results: ProcessFileResult[] = []

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency)
    const batchResults = await Promise.all(batch.map(processFile))
    results.push(...batchResults)
  }

  return results
}

/**
 * Get pending files for an agent that need processing
 */
export async function getPendingFiles(
  tenantId: string,
  agentId: string,
  limit = 10
): Promise<ProcessFileOptions[]> {
  const records = await getPendingFilesFromStore(tenantId, agentId, limit)

  return records.map((r: FileRecord) => ({
    fileId: r.id,
    agentId: r.agentId,
    tenantId: r.tenantId,
    fileKey: r.fileKey,
    fileName: r.fileName,
    mimeType: r.mimeType ?? 'application/octet-stream'
  }))
}

/**
 * Reprocess a failed file
 */
export async function reprocessFile(
  tenantId: string,
  agentId: string,
  fileId: string
): Promise<ProcessFileResult> {
  const record = await getFileById(fileId)

  if (!record) {
    return {
      success: false,
      fileId,
      chunksCreated: 0,
      tokensProcessed: 0,
      error: 'File not found'
    }
  }

  if (record.status !== 'failed' && record.status !== 'pending') {
    return {
      success: false,
      fileId,
      chunksCreated: 0,
      tokensProcessed: 0,
      error: `Cannot reprocess file in status: ${record.status}`
    }
  }

  // Reset status to pending
  await setFileStatus(fileId, 'pending', { error: null })

  return processFile({
    fileId,
    agentId: record.agentId,
    tenantId,
    fileKey: record.fileKey,
    fileName: record.fileName,
    mimeType: record.mimeType ?? 'application/octet-stream'
  })
}
