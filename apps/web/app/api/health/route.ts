import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Lightweight liveness probe: no DB or external calls, just confirms the app is
// serving requests. Used by the e2e smoke suite and uptime/health monitoring.
export function GET() {
  return NextResponse.json({ ok: true })
}
