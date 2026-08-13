import { and, desc, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { getMigrateDb, type Db } from '@vibesboard/adapter-postgres/client'
import {
  agents as agentsTable,
  agentVersions as agentVersionsTable,
} from '@vibesboard/adapter-postgres/schema'
import type {
  Agent,
  AgentConfigSnapshot,
  AgentVersion,
  AgentVersionSource,
  NewAgent,
} from '@vibesboard/adapter-postgres/schema'

/**
 * Build the immutable config snapshot for an agent row. This is the single
 * source of truth for which fields are versioned — keep it in sync with the
 * `AgentConfigSnapshot` type in the schema. Identity, counters, the version
 * pointer, `accessPasswordHash`, and timestamps are intentionally excluded.
 */
export function toAgentConfigSnapshot(row: Agent): AgentConfigSnapshot {
  return {
    name: row.name,
    instructions: row.instructions,
    mode: row.mode,
    allowAnonymous: row.allowAnonymous,
    greetingText: row.greetingText ?? null,
    quickSuggestionsMode: row.quickSuggestionsMode,
    quickSuggestionsCount: row.quickSuggestionsCount,
    tools: row.tools ?? [],
    fileKeys: row.fileKeys ?? [],
    handoffTargets: row.handoffTargets ?? [],
    collectionFields: row.collectionFields ?? null,
    maxResponses: row.maxResponses ?? null,
    maxAgentResponses: row.maxAgentResponses ?? null,
    googleReviewEnabled: row.googleReviewEnabled,
    googlePlaceId: row.googlePlaceId ?? null,
    retrievalStrategy: row.retrievalStrategy ?? null,
    schedulingConfig: row.schedulingConfig ?? null,
    notificationConfig: row.notificationConfig ?? null,
    bookingConfig: row.bookingConfig ?? null,
    dataConfig: row.dataConfig ?? null,
    calendarAvailabilityConfig: row.calendarAvailabilityConfig ?? null,
    llmConfigId: row.llmConfigId ?? null,
    memoryEnabled: row.memoryEnabled ?? false,
  }
}

/**
 * Turn a snapshot back into a partial `agents` update — used by restore to
 * apply an old version to the live row. Deliberately does NOT touch slug,
 * counters, accessPasswordHash, or the version pointer.
 */
export function applySnapshotToAgentUpdate(
  snapshot: AgentConfigSnapshot,
): Partial<NewAgent> {
  return {
    name: snapshot.name,
    instructions: snapshot.instructions,
    mode: snapshot.mode,
    allowAnonymous: snapshot.allowAnonymous,
    greetingText: snapshot.greetingText,
    quickSuggestionsMode: snapshot.quickSuggestionsMode,
    quickSuggestionsCount: snapshot.quickSuggestionsCount,
    tools: snapshot.tools,
    fileKeys: snapshot.fileKeys,
    handoffTargets: snapshot.handoffTargets,
    collectionFields: snapshot.collectionFields,
    maxResponses: snapshot.maxResponses,
    maxAgentResponses: snapshot.maxAgentResponses,
    googleReviewEnabled: snapshot.googleReviewEnabled,
    googlePlaceId: snapshot.googlePlaceId,
    retrievalStrategy: snapshot.retrievalStrategy,
    schedulingConfig: snapshot.schedulingConfig,
    notificationConfig: snapshot.notificationConfig,
    bookingConfig: snapshot.bookingConfig,
    dataConfig: snapshot.dataConfig as NewAgent['dataConfig'],
    calendarAvailabilityConfig: snapshot.calendarAvailabilityConfig,
    llmConfigId: snapshot.llmConfigId,
    memoryEnabled: snapshot.memoryEnabled,
    updatedAt: new Date(),
  }
}

/** Order-insensitive deep stringify so snapshot equality ignores key order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(',')}}`
}

export function snapshotsEqual(
  a: AgentConfigSnapshot,
  b: AgentConfigSnapshot,
): boolean {
  return stableStringify(a) === stableStringify(b)
}

interface RecordVersionOpts {
  source: AgentVersionSource
  actor?: string | null
  note?: string | null
  restoredFrom?: number | null
}

/**
 * Snapshot the current state of an agent as a new version. MUST be called
 * inside a transaction (`db` is the tx) so the row lock + pointer bump are
 * atomic and version numbers can't collide.
 *
 * - `source: 'create'` always writes v1.
 * - `source: 'restore'` always writes a new version — a restore is a
 *   deliberate user action and must leave an audit entry even when the
 *   restored config happens to equal the current live config.
 * - Any other source is a no-op (returns `{ created: false }`) when the new
 *   snapshot is identical to the current version's config — this keeps churny
 *   system/file writes from producing empty versions.
 */
export async function recordAgentVersion(
  db: Db,
  agentId: string,
  opts: RecordVersionOpts,
): Promise<{ versionNo: number; created: boolean }> {
  // Lock the agent row for the duration of the tx so concurrent writers
  // serialize on the (agentId, versionNo) sequence.
  const [row] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId))
    .limit(1)
    .for('update')

  if (!row) throw new Error(`recordAgentVersion: agent ${agentId} not found`)

  const snapshot = toAgentConfigSnapshot(row)

  if (opts.source !== 'create' && opts.source !== 'restore') {
    const [current] = await db
      .select({ config: agentVersionsTable.config })
      .from(agentVersionsTable)
      .where(
        and(
          eq(agentVersionsTable.agentId, agentId),
          eq(agentVersionsTable.versionNo, row.currentVersion),
        ),
      )
      .limit(1)

    if (current && snapshotsEqual(current.config, snapshot)) {
      return { versionNo: row.currentVersion, created: false }
    }
  }

  const versionNo = opts.source === 'create' ? 1 : row.currentVersion + 1

  await db.insert(agentVersionsTable).values({
    id: uuidv7(),
    tenantId: row.tenantId,
    agentId,
    versionNo,
    config: snapshot,
    source: opts.source,
    changeNote: opts.note ?? null,
    restoredFrom: opts.restoredFrom ?? null,
    createdBy: opts.actor ?? null,
  })

  if (versionNo !== row.currentVersion) {
    await db
      .update(agentsTable)
      .set({ currentVersion: versionNo })
      .where(eq(agentsTable.id, agentId))
  }

  return { versionNo, created: true }
}

/** The versionNo the agent's live config currently reflects (or null if the agent is gone). */
export async function getAgentCurrentVersion(
  agentId: string,
  db: Db = getMigrateDb(),
): Promise<number | null> {
  const [row] = await db
    .select({ currentVersion: agentsTable.currentVersion })
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId))
    .limit(1)
  return row?.currentVersion ?? null
}

/** List an agent's versions, newest first. Config bodies are omitted. */
export async function listAgentVersions(
  agentId: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
  db: Db = getMigrateDb(),
): Promise<Array<Omit<AgentVersion, 'config'>>> {
  return db
    .select({
      id: agentVersionsTable.id,
      tenantId: agentVersionsTable.tenantId,
      agentId: agentVersionsTable.agentId,
      versionNo: agentVersionsTable.versionNo,
      source: agentVersionsTable.source,
      changeNote: agentVersionsTable.changeNote,
      restoredFrom: agentVersionsTable.restoredFrom,
      createdBy: agentVersionsTable.createdBy,
      createdAt: agentVersionsTable.createdAt,
    })
    .from(agentVersionsTable)
    .where(eq(agentVersionsTable.agentId, agentId))
    .orderBy(desc(agentVersionsTable.versionNo))
    .limit(limit)
    .offset(offset)
}

/** Fetch a single version (including its config snapshot). */
export async function getAgentVersion(
  agentId: string,
  versionNo: number,
  db: Db = getMigrateDb(),
): Promise<AgentVersion | null> {
  const [row] = await db
    .select()
    .from(agentVersionsTable)
    .where(
      and(
        eq(agentVersionsTable.agentId, agentId),
        eq(agentVersionsTable.versionNo, versionNo),
      ),
    )
    .limit(1)
  return row ?? null
}

export interface RestoreResult {
  versionNo: number
  snapshot: AgentConfigSnapshot
  /** fileKeys the agent had immediately before the restore was applied. */
  previousFileKeys: string[]
}

/**
 * Restore an agent to a prior version's config. Forward-only: applies the old
 * config to the live row and appends a NEW version (source `restore`) — history
 * is never rewritten. Returns the applied snapshot plus the pre-restore
 * fileKeys so the caller can reconcile file embeddings.
 */
export async function restoreAgentVersion(
  agentId: string,
  versionNo: number,
  { actor, note }: { actor?: string | null; note?: string | null } = {},
  db: Db = getMigrateDb(),
): Promise<RestoreResult> {
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db

    const [live] = await txDb
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId))
      .limit(1)
      .for('update')
    if (!live) throw new Error(`restoreAgentVersion: agent ${agentId} not found`)

    const target = await getAgentVersion(agentId, versionNo, txDb)
    if (!target) {
      throw new Error(
        `restoreAgentVersion: version ${versionNo} not found for agent ${agentId}`,
      )
    }

    const previousFileKeys = live.fileKeys ?? []

    await txDb
      .update(agentsTable)
      .set(applySnapshotToAgentUpdate(target.config))
      .where(eq(agentsTable.id, agentId))

    const { versionNo: newVersionNo } = await recordAgentVersion(txDb, agentId, {
      source: 'restore',
      actor,
      note: note ?? `Restored from v${versionNo}`,
      restoredFrom: versionNo,
    })

    return { versionNo: newVersionNo, snapshot: target.config, previousFileKeys }
  })
}
