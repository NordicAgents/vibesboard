/**
 * File Processor Service
 * Handles automatic background processing of uploaded files for RAG
 */

import { adminDb } from '@/lib/firebase/admin'
import { ingestFileForAgent } from '@/lib/agent/file-search'
import { Collections } from '@/lib/firestore-types'

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
    await markFileProcessing(tenantId, agentId, fileId)

    console.log(`[FileProcessor] Processing file: ${fileName} (${fileId})`)

    // 2. Use existing ingestion logic (extract -> chunk -> embed)
    const result = await ingestFileForAgent({
      tenantId,
      agentId,
      fileKey,
      fileName,
      mimeType
    })

    // 3. Link chunks to file_id
    await linkChunksToFile(tenantId, agentId, fileKey, fileId)

    // 4. Estimate token count (approximate: 1 token ~ 4 chars)
    const estimatedTokens = result.totalChars
      ? Math.ceil(result.totalChars / 4)
      : Math.ceil((result.chunksInserted * 1200) / 4)

    // 5. Mark file as indexed
    await markFileIndexed(tenantId, agentId, fileId)

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

    await markFileFailed(tenantId, agentId, fileId, errorMessage)

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
  const collPath = Collections.agentFiles(tenantId, agentId)

  const snapshot = await adminDb
    .collection(collPath)
    .where('status', '==', 'pending')
    .orderBy('createdAt', 'asc')
    .limit(limit)
    .get()

  return snapshot.docs.map((doc: any) => {
    const data = doc.data()
    return {
      fileId: doc.id,
      agentId: data.agentId,
      tenantId,
      fileKey: data.fileKey,
      fileName: data.fileName,
      mimeType: data.mimeType ?? 'application/octet-stream'
    }
  })
}

/**
 * Reprocess a failed file
 */
export async function reprocessFile(
  tenantId: string,
  agentId: string,
  fileId: string
): Promise<ProcessFileResult> {
  const collPath = Collections.agentFiles(tenantId, agentId)
  const docRef = adminDb.collection(collPath).doc(fileId)
  const doc = await docRef.get()

  if (!doc.exists) {
    return {
      success: false,
      fileId,
      chunksCreated: 0,
      tokensProcessed: 0,
      error: 'File not found'
    }
  }

  const data = doc.data()!
  if (data.status !== 'failed' && data.status !== 'pending') {
    return {
      success: false,
      fileId,
      chunksCreated: 0,
      tokensProcessed: 0,
      error: `Cannot reprocess file in status: ${data.status}`
    }
  }

  // Reset status
  await docRef.update({
    status: 'pending',
    processingError: null,
    processingStartedAt: null,
    processingCompletedAt: null
  })

  return processFile({
    fileId,
    agentId: data.agentId,
    tenantId,
    fileKey: data.fileKey,
    fileName: data.fileName,
    mimeType: data.mimeType ?? 'application/octet-stream'
  })
}

// ============================================================================
// Helper Functions
// ============================================================================

async function markFileProcessing(
  tenantId: string,
  agentId: string,
  fileId: string
): Promise<void> {
  const collPath = Collections.agentFiles(tenantId, agentId)
  await adminDb.collection(collPath).doc(fileId).update({
    status: 'processing',
    processingStartedAt: new Date().toISOString()
  })
}

async function markFileIndexed(
  tenantId: string,
  agentId: string,
  fileId: string
): Promise<void> {
  const collPath = Collections.agentFiles(tenantId, agentId)
  await adminDb.collection(collPath).doc(fileId).update({
    status: 'indexed',
    processingCompletedAt: new Date().toISOString()
  })
}

async function markFileFailed(
  tenantId: string,
  agentId: string,
  fileId: string,
  error: string
): Promise<void> {
  const collPath = Collections.agentFiles(tenantId, agentId)
  await adminDb
    .collection(collPath)
    .doc(fileId)
    .update({
      status: 'failed',
      processingError: error.slice(0, 500),
      processingCompletedAt: new Date().toISOString()
    })
}

async function linkChunksToFile(
  tenantId: string,
  agentId: string,
  fileKey: string,
  fileId: string
): Promise<void> {
  const collPath = Collections.fileChunks(tenantId, agentId)
  const snapshot = await adminDb
    .collection(collPath)
    .where('fileKey', '==', fileKey)
    .get()

  if (snapshot.empty) return

  // Split into batches of 400 to stay under Firestore's 500-op limit
  const BATCH_LIMIT = 400
  for (let i = 0; i < snapshot.docs.length; i += BATCH_LIMIT) {
    const batch = adminDb.batch()
    snapshot.docs.slice(i, i + BATCH_LIMIT).forEach((doc: any) => {
      batch.update(doc.ref, { fileId })
    })
    await batch.commit()
  }
}
