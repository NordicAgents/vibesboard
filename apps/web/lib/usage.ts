// Hybrid shim — re-exports the pure usage helpers from @vibesboard/policy
// AND keeps the one NextResponse-returning helper here.
//
// usageLimitResponse stays in apps/web because @vibesboard/policy is a
// feature package and can't depend on `next/server`. Five API route
// handlers call this helper directly (e.g. apps/web/app/api/agents/[id]/
// chat/route.ts:59). Their imports `import { usageLimitResponse } from
// '@/lib/usage'` resolve to this file unchanged. The pure helpers
// (checkUsageLimit, recordUsage, etc.) come from policy.
//
// Deleted in Phase 12 once usageLimitResponse moves into the API route
// handlers or behind an IUsageRecorder port.

export * from '@vibesboard/policy/usage'

import { NextResponse } from 'next/server'
import type { UsageLimitResult } from '@vibesboard/policy/usage'

/**
 * Build a 429 JSON response for when usage limit is reached.
 */
export function usageLimitResponse(result: UsageLimitResult) {
  return NextResponse.json(
    {
      error: 'usage_limit_reached',
      message: `You've used all ${result.limit} messages this month.`,
      used: result.used,
      limit: result.limit
    },
    { status: 429 }
  )
}
