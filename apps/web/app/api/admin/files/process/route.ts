import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/route-handler'
import {
  processBatch,
  type ProcessFileOptions
} from '@vibesboard/ai/file-processor'
import {
  listFilesForAdmin,
  countFilesByStatus,
  getFilesByIds,
  listFilesForProcessing
} from '@vibesboard/ai/file-admin'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes for batch processing

/**
 * Admin File Processing Observability
 *
 * GET /api/admin/files/process - View pending/failed files
 * POST /api/admin/files/process - Manually trigger batch processing
 *
 * Requires: Super Admin role
 */

/**
 * GET - View file processing status (observability)
 */
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') // 'pending', 'failed', 'processing', 'indexed'
  const limit = parseInt(searchParams.get('limit') || '50')
  const agentId = searchParams.get('agent_id')

  try {
    const files = await listFilesForAdmin({ status, agentId, limit })
    const stats = await countFilesByStatus()

    return NextResponse.json({
      files,
      stats,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Admin] File status fetch failed:', errorMessage)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

/**
 * POST - Manually trigger batch processing
 */
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  try {
    const body = await req.json()
    const {
      fileIds, // Specific file IDs to process
      status = 'pending', // Or 'failed' to retry failed files
      limit = 50,
      concurrency = 5
    } = body

    console.log(
      `[Admin] Manual batch processing triggered by ${auth.user.email}`
    )

    let filesToProcess: ProcessFileOptions[] = []

    if (fileIds && Array.isArray(fileIds) && fileIds.length > 0) {
      filesToProcess = await getFilesByIds(fileIds)
      console.log(`[Admin] Processing ${filesToProcess.length} specific files`)
    } else {
      const targetStatus = status === 'failed' ? 'failed' : 'pending'
      filesToProcess = await listFilesForProcessing(targetStatus, limit)
      console.log(
        `[Admin] Processing ${filesToProcess.length} ${targetStatus} files`
      )
    }

    if (filesToProcess.length === 0) {
      return NextResponse.json({
        success: true,
        processed: 0,
        message: `No ${status} files to process`,
        timestamp: new Date().toISOString()
      })
    }

    // Process in batches
    const results = await processBatch(filesToProcess, concurrency)

    const successCount = results.filter(r => r.success).length
    const failedCount = results.filter(r => !r.success).length
    const totalChunks = results.reduce((sum, r) => sum + r.chunksCreated, 0)
    const totalTokens = results.reduce((sum, r) => sum + r.tokensProcessed, 0)

    console.log(
      `[Admin] Batch processing complete: ${successCount} success, ${failedCount} failed, ${totalChunks} chunks, ${totalTokens} tokens`
    )

    return NextResponse.json({
      success: true,
      processed: filesToProcess.length,
      successCount,
      failedCount,
      totalChunks,
      totalTokens,
      results: results.map(r => ({
        fileId: r.fileId,
        success: r.success,
        chunksCreated: r.chunksCreated,
        tokensProcessed: r.tokensProcessed,
        error: r.error
      })),
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Admin] Batch processing failed:', errorMessage)

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}
