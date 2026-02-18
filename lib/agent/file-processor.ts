/**
 * File Processor Service
 * Handles automatic background processing of uploaded files for RAG
 *
 * Best Practices Implemented:
 * - Optimal chunk size (1200 chars) with overlap (200 chars)
 * - Sentence-aware chunking to preserve context
 * - Batch embedding generation to reduce API calls
 * - Error handling with detailed logging
 * - Token counting for cost tracking
 * - Idempotent processing (can safely retry)
 */

import { type SupabaseClient } from '@supabase/supabase-js'
import { getServiceSupabaseClient } from '@/lib/supabase/service-client'
import { ingestFileForAgent } from '@/lib/agent/file-search'
import { type Database } from '@/lib/db_types'

export interface ProcessFileOptions {
  fileId: string
  agentId: string
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
 * Process a single file: extract text → chunk → embed → store
 *
 * This is the main entry point for background file processing
 */
export async function processFile(
  options: ProcessFileOptions
): Promise<ProcessFileResult> {
  const { fileId, agentId, fileKey, fileName, mimeType } = options
  const supabase = getServiceSupabaseClient()

  try {
    // 1. Mark file as processing
    await markFileProcessing(supabase, fileId)

    console.log(`[FileProcessor] Processing file: ${fileName} (${fileId})`)

    // 2. Use existing ingestion logic (extract → chunk → embed)
    const result = await ingestFileForAgent({
      agentId,
      fileKey,
      fileName,
      mimeType
    })

    // 3. Link chunks to file_id (update agent_file_chunks)
    await linkChunksToFile(supabase, agentId, fileKey, fileId)

    // 4. Estimate token count (approximate: 1 token ≈ 4 chars for English)
    const estimatedTokens = Math.ceil(result.chunksInserted * 1200 / 4)

    // 5. Mark file as indexed
    await markFileIndexed(
      supabase,
      fileId,
      result.chunksInserted,
      estimatedTokens
    )

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

    console.error(`[FileProcessor] Failed to process ${fileName}:`, errorMessage)

    // Mark file as failed
    await markFileFailed(supabase, fileId, errorMessage)

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
  agentId: string,
  limit = 10
): Promise<ProcessFileOptions[]> {
  const supabase = getServiceSupabaseClient()

  const { data: files, error } = await supabase
    .from('agent_files')
    .select('id, agent_id, file_key, file_name, mime_type')
    .eq('agent_id', agentId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[FileProcessor] Error fetching pending files:', error)
    return []
  }

  return (files ?? []).map(file => ({
    fileId: file.id,
    agentId: file.agent_id,
    fileKey: file.file_key,
    fileName: file.file_name,
    mimeType: file.mime_type ?? 'application/octet-stream'
  }))
}

/**
 * Get all pending files across all agents (for cron job)
 */
export async function getAllPendingFiles(
  limit = 50
): Promise<ProcessFileOptions[]> {
  const supabase = getServiceSupabaseClient()

  const { data: files, error } = await supabase
    .from('agent_files')
    .select('id, agent_id, file_key, file_name, mime_type')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[FileProcessor] Error fetching all pending files:', error)
    return []
  }

  return (files ?? []).map(file => ({
    fileId: file.id,
    agentId: file.agent_id,
    fileKey: file.file_key,
    fileName: file.file_name,
    mimeType: file.mime_type ?? 'application/octet-stream'
  }))
}

/**
 * Reprocess a failed file
 */
export async function reprocessFile(fileId: string): Promise<ProcessFileResult> {
  const supabase = getServiceSupabaseClient()

  // Get file details
  const { data: file, error } = await supabase
    .from('agent_files')
    .select('id, agent_id, file_key, file_name, mime_type, status')
    .eq('id', fileId)
    .single()

  if (error || !file) {
    return {
      success: false,
      fileId,
      chunksCreated: 0,
      tokensProcessed: 0,
      error: 'File not found'
    }
  }

  if (file.status !== 'failed' && file.status !== 'pending') {
    return {
      success: false,
      fileId,
      chunksCreated: 0,
      tokensProcessed: 0,
      error: `Cannot reprocess file in status: ${file.status}`
    }
  }

  // Reset status to pending before reprocessing
  await supabase
    .from('agent_files')
    .update({
      status: 'pending',
      processing_error: null,
      processing_started_at: null,
      processing_completed_at: null
    })
    .eq('id', fileId)

  // Process the file
  return processFile({
    fileId: file.id,
    agentId: file.agent_id,
    fileKey: file.file_key,
    fileName: file.file_name,
    mimeType: file.mime_type ?? 'application/octet-stream'
  })
}

// ============================================================================
// Helper Functions
// ============================================================================

async function markFileProcessing(
  supabase: SupabaseClient<Database>,
  fileId: string
): Promise<void> {
  await supabase.rpc('mark_file_processing', { p_file_id: fileId })
}

async function markFileIndexed(
  supabase: SupabaseClient<Database>,
  fileId: string,
  chunkCount: number,
  totalTokens: number
): Promise<void> {
  await supabase.rpc('mark_file_indexed', {
    p_file_id: fileId,
    p_chunk_count: chunkCount,
    p_total_tokens: totalTokens
  })
}

async function markFileFailed(
  supabase: SupabaseClient<Database>,
  fileId: string,
  error: string
): Promise<void> {
  await supabase.rpc('mark_file_failed', {
    p_file_id: fileId,
    p_error: error.slice(0, 500) // Limit error message length
  })
}

/**
 * Link existing chunks to file_id
 * (Chunks were created without file_id, now we update them)
 */
async function linkChunksToFile(
  supabase: SupabaseClient<Database>,
  agentId: string,
  fileKey: string,
  fileId: string
): Promise<void> {
  const { error } = await supabase
    .from('agent_file_chunks')
    .update({ file_id: fileId })
    .eq('agent_id', agentId)
    .eq('file_key', fileKey)
    .is('file_id', null)

  if (error) {
    console.warn('[FileProcessor] Failed to link chunks to file:', error)
  }
}

/**
 * Get file statistics for an agent
 */
export async function getAgentFileStats(agentId: string) {
  const supabase = getServiceSupabaseClient()

  const { data, error } = await supabase.rpc('get_agent_file_stats', {
    p_agent_id: agentId
  })

  if (error) {
    console.error('[FileProcessor] Error getting file stats:', error)
    return null
  }

  return data?.[0] ?? null
}
