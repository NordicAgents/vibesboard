import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { dataActionLogs } from '@vibesboard/adapter-postgres/schema'
import type { DataProvider, DataActionType } from '@vibesboard/contracts'

type Db = PostgresJsDatabase<typeof schema>

export interface RecordDataActionLogParams {
  tenantId: string
  agentId: string
  conversationId?: string | null
  connectionId: string
  provider: DataProvider
  action: DataActionType
  status: 'success' | 'failed'
  rowData: Record<string, unknown>
  externalRef?: string
  error?: string
}

export async function recordDataActionLog(
  p: RecordDataActionLogParams,
  db: Db = getMigrateDb()
): Promise<void> {
  await db.insert(dataActionLogs).values({
    id: uuidv7(),
    tenantId: p.tenantId,
    agentId: p.agentId,
    conversationId: p.conversationId ?? null,
    connectionId: p.connectionId,
    provider: p.provider,
    action: p.action,
    status: p.status,
    rowData: p.rowData,
    externalRef: p.externalRef ?? null,
    error: p.error ?? null,
  })
}
