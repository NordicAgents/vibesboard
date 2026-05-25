import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { files } from '@vibesboard/adapter-postgres/schema'

type Db = PostgresJsDatabase<typeof schema>

const VALID_STATUSES = ['pending', 'processing', 'indexed', 'failed'] as const
type FileStatus = (typeof VALID_STATUSES)[number]

export interface AdminFileRow {
  id: string
  agentId: string
  tenantId: string
  fileName: string
  fileSize: number
  mimeType: string
  status: string
  error: string | null
  processingStartedAt: string | null
  processingCompletedAt: string | null
  createdAt: string
}

export interface AdminFileProcessing {
  fileId: string
  agentId: string
  tenantId: string
  fileKey: string
  fileName: string
  mimeType: string
}

function rowToAdminFile(r: typeof files.$inferSelect): AdminFileRow {
  return {
    id: r.id,
    agentId: r.agentId,
    tenantId: r.tenantId,
    fileName: r.fileName,
    fileSize: r.fileSize,
    mimeType: r.mimeType,
    status: r.status,
    error: r.processingError,
    processingStartedAt: r.processingStartedAt?.toISOString() ?? null,
    processingCompletedAt: r.processingCompletedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }
}

function toProcessing(r: typeof files.$inferSelect): AdminFileProcessing {
  return {
    fileId: r.id,
    agentId: r.agentId,
    tenantId: r.tenantId,
    fileKey: r.fileKey,
    fileName: r.fileName,
    mimeType: r.mimeType || 'application/octet-stream',
  }
}

/**
 * Cross-tenant admin observability listing (super-admin only). Optional
 * `status`/`agentId` filters; newest-first; capped by `limit`.
 */
export async function listFilesForAdmin(
  opts: { status?: string | null; agentId?: string | null; limit: number },
  db: Db = getMigrateDb(),
): Promise<AdminFileRow[]> {
  const conds = []
  if (opts.status && (VALID_STATUSES as readonly string[]).includes(opts.status)) {
    conds.push(eq(files.status, opts.status as FileStatus))
  }
  if (opts.agentId) conds.push(eq(files.agentId, opts.agentId))
  const where = conds.length ? and(...conds) : undefined
  const rows = await db
    .select()
    .from(files)
    .where(where)
    .orderBy(desc(files.createdAt))
    .limit(opts.limit)
  return rows.map(rowToAdminFile)
}

export interface FileStatusCounts {
  total: number
  pending: number
  processing: number
  indexed: number
  failed: number
}

/** Cross-tenant GROUP BY status tally for the admin dashboard. */
export async function countFilesByStatus(
  db: Db = getMigrateDb(),
): Promise<FileStatusCounts> {
  const rows = await db
    .select({ status: files.status, n: sql<number>`count(*)` })
    .from(files)
    .groupBy(files.status)
  const counts: FileStatusCounts = {
    total: 0,
    pending: 0,
    processing: 0,
    indexed: 0,
    failed: 0,
  }
  for (const r of rows) {
    const n = Number(r.n)
    counts.total += n
    if (r.status in counts) counts[r.status as FileStatus] = n
  }
  return counts
}

/**
 * Resolve a set of file IDs to the shape `processBatch` expects. Cross-tenant
 * (super-admin only). Returns [] for an empty id list.
 */
export async function getFilesByIds(
  fileIds: string[],
  db: Db = getMigrateDb(),
): Promise<AdminFileProcessing[]> {
  if (!fileIds.length) return []
  const rows = await db.select().from(files).where(inArray(files.id, fileIds))
  return rows.map(toProcessing)
}

/**
 * Pending/failed files (oldest-first) to feed `processBatch`. Cross-tenant
 * (super-admin only).
 */
export async function listFilesForProcessing(
  status: FileStatus,
  limit: number,
  db: Db = getMigrateDb(),
): Promise<AdminFileProcessing[]> {
  const rows = await db
    .select()
    .from(files)
    .where(eq(files.status, status))
    .orderBy(files.createdAt)
    .limit(limit)
  return rows.map(toProcessing)
}
