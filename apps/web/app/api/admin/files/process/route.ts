import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/route-handler'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import {
  processBatch,
  type ProcessFileOptions
} from '@vibesboard/ai/file-processor'

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
    // Use collectionGroup query on 'files' to query across all tenants/agents
    let query: FirebaseFirestore.Query = adminDb
      .collectionGroup('files')
      .orderBy('createdAt', 'desc')
      .limit(limit)

    // Filter by status if provided
    if (
      status &&
      ['pending', 'processing', 'indexed', 'failed'].includes(status)
    ) {
      query = query.where('status', '==', status)
    }

    // Filter by agent if provided
    if (agentId) {
      query = query.where('agentId', '==', agentId)
    }

    const snapshot = await query.get()

    const files = snapshot.docs.map(doc => {
      const data = doc.data()
      return {
        id: doc.id,
        agentId: data.agentId,
        tenantId: data.tenantId,
        fileName: data.fileName,
        fileSize: data.fileSize,
        mimeType: data.mimeType,
        status: data.status,
        error: data.processingError,
        processingStartedAt: data.processingStartedAt,
        processingCompletedAt: data.processingCompletedAt,
        createdAt: data.createdAt
      }
    })

    // Get summary statistics using collectionGroup
    const statusCounts = {
      total: 0,
      pending: 0,
      processing: 0,
      indexed: 0,
      failed: 0
    }

    const allFilesSnapshot = await adminDb
      .collectionGroup('files')
      .select('status')
      .get()

    for (const doc of allFilesSnapshot.docs) {
      const fileStatus = doc.data().status as keyof typeof statusCounts
      if (fileStatus in statusCounts) {
        statusCounts[fileStatus]++
      }
      statusCounts.total++
    }

    return NextResponse.json({
      files,
      stats: statusCounts,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Admin] File status fetch failed:', errorMessage)

    // Detect missing Firestore index errors
    const isMissingIndex =
      errorMessage.includes('FAILED_PRECONDITION') ||
      errorMessage.includes('requires an index')
    if (isMissingIndex) {
      return NextResponse.json(
        {
          error:
            'Firestore indexes are still building. Please wait a few minutes and try again.',
          detail: errorMessage,
          files: [],
          stats: { total: 0, pending: 0, processing: 0, indexed: 0, failed: 0 }
        },
        { status: 503 }
      )
    }

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
      // Process specific files — look them up via collectionGroup
      const snapshot = await adminDb
        .collectionGroup('files')
        .where('id', 'in', fileIds)
        .get()

      filesToProcess = snapshot.docs.map((doc: any) => {
        const data = doc.data()
        return {
          fileId: doc.id,
          agentId: data.agentId,
          tenantId: data.tenantId,
          fileKey: data.fileKey,
          fileName: data.fileName,
          mimeType: data.mimeType || 'application/octet-stream'
        }
      })

      console.log(`[Admin] Processing ${filesToProcess.length} specific files`)
    } else {
      // Get pending or failed files via collectionGroup
      const targetStatus = status === 'failed' ? 'failed' : 'pending'
      const snapshot = await adminDb
        .collectionGroup('files')
        .where('status', '==', targetStatus)
        .orderBy('createdAt', 'asc')
        .limit(limit)
        .get()

      filesToProcess = snapshot.docs.map((doc: any) => {
        const data = doc.data()
        return {
          fileId: doc.id,
          agentId: data.agentId,
          tenantId: data.tenantId,
          fileKey: data.fileKey,
          fileName: data.fileName,
          mimeType: data.mimeType || 'application/octet-stream'
        }
      })

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
