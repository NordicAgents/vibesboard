import { and, count, asc, eq, inArray, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { files } from '@vibesboard/adapter-postgres/schema'

type Db = PostgresJsDatabase<typeof schema>
export type FileStatus = 'pending' | 'processing' | 'indexed' | 'failed'
export interface FileRecord {
  id: string; agentId: string; tenantId: string; userId: string | null
  fileKey: string; fileName: string; mimeType: string; fileSize: number
  status: string; processingError: string | null
  embeddingProvider: string | null
  createdAt: string; updatedAt: string
}
function rowToFile(r: typeof files.$inferSelect): FileRecord {
  return { id: r.id, agentId: r.agentId, tenantId: r.tenantId, userId: r.userId,
    fileKey: r.fileKey, fileName: r.fileName, mimeType: r.mimeType, fileSize: r.fileSize,
    status: r.status, processingError: r.processingError,
    embeddingProvider: r.embeddingProvider ?? null,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }
}
export interface InsertFileInput { tenantId: string; agentId: string; userId: string | null; fileKey: string; fileName: string; mimeType: string; fileSize: number }
/** Bulk-insert file records (status 'pending'); returns created records. */
export async function insertFiles(inputs: InsertFileInput[], db: Db = getMigrateDb()): Promise<FileRecord[]> {
  if (!inputs.length) return []
  const uniqueInputs = Array.from(
    new Map(inputs.map(input => [`${input.agentId}\0${input.fileKey}`, input])).values()
  )
  const rows = await db
    .insert(files)
    .values(uniqueInputs.map((f) => ({ id: uuidv7(), ...f, status: 'pending' as const })))
    .onConflictDoUpdate({
      target: [files.agentId, files.fileKey],
      set: {
        fileName: sql`excluded.file_name`,
        mimeType: sql`excluded.mime_type`,
        fileSize: sql`excluded.file_size`,
        userId: sql`excluded.user_id`,
        // Reset to pending so the UI reflects re-ingestion in progress.
        // Without this a previously-failed or indexed file would keep its old
        // status through the entire ingestion, showing stale state to the user.
        status: sql`'pending'`,
        updatedAt: new Date(),
      },
    })
    .returning()
  return rows.map(rowToFile)
}
export async function listFiles(opts: { tenantId: string; agentId: string; status?: string; page: number; limit: number }, db: Db = getMigrateDb()): Promise<{ files: FileRecord[]; total: number }> {
  const valid = ['pending','processing','indexed','failed'].includes(opts.status ?? '') ? (opts.status as FileStatus) : undefined
  const where = valid ? and(eq(files.agentId, opts.agentId), eq(files.status, valid)) : eq(files.agentId, opts.agentId)
  const tot = await db.select({ n: count() }).from(files).where(where)
  const rows = await db.select().from(files).where(where).orderBy(asc(files.createdAt)).limit(opts.limit).offset((opts.page - 1) * opts.limit)
  return { files: rows.map(rowToFile), total: Number(tot[0]?.n ?? 0) }
}
export async function getFileById(fileId: string, db: Db = getMigrateDb()): Promise<FileRecord | null> {
  const rows = await db.select().from(files).where(eq(files.id, fileId)).limit(1)
  return rows.length ? rowToFile(rows[0]) : null
}
export async function setFileStatus(fileId: string, status: FileStatus, opts: { error?: string | null } = {}, db: Db = getMigrateDb()): Promise<void> {
  const set: Record<string, unknown> = { status, updatedAt: new Date() }
  if (status === 'processing') set.processingStartedAt = new Date()
  if (status === 'indexed' || status === 'failed') set.processingCompletedAt = new Date()
  if (opts.error !== undefined) set.processingError = opts.error ? opts.error.slice(0, 500) : null
  await db.update(files).set(set).where(eq(files.id, fileId))
}
export async function getPendingFiles(tenantId: string, agentId: string, limit = 10, db: Db = getMigrateDb()): Promise<FileRecord[]> {
  const rows = await db.select().from(files).where(and(eq(files.tenantId, tenantId), eq(files.agentId, agentId), eq(files.status, 'pending'))).orderBy(asc(files.createdAt)).limit(limit)
  return rows.map(rowToFile)
}
export async function getFileByKey(agentId: string, fileKey: string, db: Db = getMigrateDb()): Promise<FileRecord | null> {
  const rows = await db.select().from(files).where(and(eq(files.agentId, agentId), eq(files.fileKey, fileKey))).limit(1)
  return rows.length ? rowToFile(rows[0]) : null
}
/** Fetch every file row for an agent. Intended for transactional cleanup paths. */
export async function getFilesForAgent(agentId: string, db: Db = getMigrateDb()): Promise<FileRecord[]> {
  const rows = await db.select().from(files).where(eq(files.agentId, agentId))
  return rows.map(rowToFile)
}
/** Fetch existing file records for a specific set of fileKeys — bounded by the input, no pagination needed. */
export async function getFilesByKeys(agentId: string, fileKeys: string[], db: Db = getMigrateDb()): Promise<FileRecord[]> {
  if (!fileKeys.length) return []
  const rows = await db.select().from(files).where(and(eq(files.agentId, agentId), inArray(files.fileKey, fileKeys)))
  return rows.map(rowToFile)
}
/** Delete the file row for an agent/key pair and return what was removed. */
export async function deleteFilesByKey(agentId: string, fileKey: string, db: Db = getMigrateDb()): Promise<FileRecord[]> {
  const rows = await db
    .delete(files)
    .where(and(eq(files.agentId, agentId), eq(files.fileKey, fileKey)))
    .returning()
  return rows.map(rowToFile)
}
