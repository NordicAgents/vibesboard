import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { isSuperAdmin } from '@/lib/permissions'
import {
  getAllPendingFiles,
  processBatch,
  getAgentFileStats
} from '@/lib/agent/file-processor'
import { getServiceSupabaseClient } from '@/lib/supabase/service-client'

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
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // Only super admins can access
  const isAdmin = await isSuperAdmin(session.user.id)
  if (!isAdmin) {
    return new NextResponse('Forbidden - Admin access required', { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') // 'pending', 'failed', 'processing', 'indexed'
  const limit = parseInt(searchParams.get('limit') || '50')
  const agentId = searchParams.get('agent_id')

  const supabase = getServiceSupabaseClient()

  try {
    // Build query
    let query = supabase
      .from('agent_files')
      .select(`
        id,
        agent_id,
        file_name,
        file_size,
        mime_type,
        status,
        chunk_count,
        total_tokens,
        processing_error,
        processing_started_at,
        processing_completed_at,
        created_at,
        vibe_agents!inner(id, name, user_id)
      `)
      .order('created_at', { ascending: false })
      .limit(limit)

    // Filter by status if provided
    if (status && ['pending', 'processing', 'indexed', 'failed'].includes(status)) {
      query = query.eq('status', status)
    }

    // Filter by agent if provided
    if (agentId) {
      query = query.eq('agent_id', agentId)
    }

    const { data: files, error } = await query

    if (error) {
      throw error
    }

    // Get summary statistics
    const { data: stats } = await supabase
      .from('agent_files')
      .select('status', { count: 'exact' })

    const statusCounts = {
      total: 0,
      pending: 0,
      processing: 0,
      indexed: 0,
      failed: 0
    }

    if (stats) {
      for (const item of stats) {
        statusCounts[item.status as keyof typeof statusCounts] =
          (statusCounts[item.status as keyof typeof statusCounts] || 0) + 1
        statusCounts.total++
      }
    }

    return NextResponse.json({
      files: files?.map(file => ({
        id: file.id,
        agentId: file.agent_id,
        agentName: (file.vibe_agents as any)?.name,
        fileName: file.file_name,
        fileSize: file.file_size,
        mimeType: file.mime_type,
        status: file.status,
        chunkCount: file.chunk_count,
        totalTokens: file.total_tokens,
        error: file.processing_error,
        processingStartedAt: file.processing_started_at,
        processingCompletedAt: file.processing_completed_at,
        createdAt: file.created_at
      })) || [],
      stats: statusCounts,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Admin] File status fetch failed:', errorMessage)

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}

/**
 * POST - Manually trigger batch processing
 */
export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // Only super admins can trigger processing
  const isAdmin = await isSuperAdmin(session.user.id)
  if (!isAdmin) {
    return new NextResponse('Forbidden - Admin access required', { status: 403 })
  }

  try {
    const body = await req.json()
    const {
      fileIds, // Specific file IDs to process
      status = 'pending', // Or 'failed' to retry failed files
      limit = 50,
      concurrency = 5
    } = body

    console.log(`[Admin] Manual batch processing triggered by ${session.user.email}`)

    let filesToProcess

    if (fileIds && Array.isArray(fileIds) && fileIds.length > 0) {
      // Process specific files
      const supabase = getServiceSupabaseClient()
      const { data: files, error } = await supabase
        .from('agent_files')
        .select('id, agent_id, file_key, file_name, mime_type')
        .in('id', fileIds)

      if (error) throw error
      filesToProcess = files || []

      console.log(`[Admin] Processing ${filesToProcess.length} specific files`)
    } else {
      // Get pending or failed files
      if (status === 'failed') {
        // Get failed files for retry
        const supabase = getServiceSupabaseClient()
        const { data: files, error } = await supabase
          .from('agent_files')
          .select('id, agent_id, file_key, file_name, mime_type')
          .eq('status', 'failed')
          .limit(limit)

        if (error) throw error
        filesToProcess = files || []

        console.log(`[Admin] Retrying ${filesToProcess.length} failed files`)
      } else {
        // Get pending files
        filesToProcess = await getAllPendingFiles(limit)
        console.log(`[Admin] Processing ${filesToProcess.length} pending files`)
      }
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
    const results = await processBatch(
      filesToProcess.map(f => ({
        fileId: f.id,
        agentId: f.agent_id,
        fileKey: f.file_key,
        fileName: f.file_name,
        mimeType: f.mime_type || 'application/octet-stream'
      })),
      concurrency
    )

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
