import { NextRequest, NextResponse } from 'next/server'
// Hybrid memory tables are RLS-denied for the app role (drizzle migration 0020)
// — memory jobs run on the BYPASSRLS migrate client.
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { runMemoryReconcile } from '@vibesboard/ai/agent-memory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Allow up to 5 minutes — reconciliation calls the LLM per observation batch
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getMigrateDb()
  const result = await runMemoryReconcile(db)
  return NextResponse.json({ ok: true, ...result })
}
