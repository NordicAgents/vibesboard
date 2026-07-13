import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@vibesboard/adapter-postgres/client'
import { runMemoryObserve } from '@vibesboard/ai/agent-memory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Allow up to 5 minutes — observation formation calls the LLM per conversation
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getDb()
  const result = await runMemoryObserve(db)
  return NextResponse.json({ ok: true, ...result })
}
