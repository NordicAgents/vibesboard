import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, requireTenantAdmin } from '@/lib/auth/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import {
  listTaskAssignments,
  setTaskAssignment,
  clearTaskAssignment
} from '@vibesboard/ai/tenant-llm-config'

export const runtime = 'nodejs'

const VALID_TASKS = ['chat', 'embed', 'agent_creator', '*'] as const

const setSchema = z.object({
  task: z.enum(VALID_TASKS),
  configId: z.string().uuid().nullable() // null = clear the assignment
})

async function guard(userId: string) {
  const tenantId = await getActiveTenant(userId)
  if (!tenantId)
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'No active tenant' },
        { status: 400 }
      )
    }
  const adminResult = await requireTenantAdmin(tenantId)
  if (!adminResult.ok)
    return { ok: false as const, response: adminResult.response }
  const enabled = await isFeatureEnabled(tenantId, 'BYO_LLM')
  if (!enabled)
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'BYO_LLM is not enabled' },
        { status: 403 }
      )
    }
  return { ok: true as const, tenantId }
}

/**
 * GET /api/tenants/llm-configs/tasks
 * List all task→config assignments for the active tenant.
 */
export async function GET() {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response
  const g = await guard(authResult.user.id)
  if (!g.ok) return g.response
  const assignments = await listTaskAssignments(g.tenantId)
  return NextResponse.json({ assignments })
}

/**
 * PUT /api/tenants/llm-configs/tasks
 * Assign or clear a task→config mapping.
 * Body: { task, configId }  — configId: null clears the assignment.
 */
export async function PUT(request: NextRequest) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response
  const g = await guard(authResult.user.id)
  if (!g.ok) return g.response

  const body = await request.json().catch(() => null)
  const parsed = setSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { task, configId } = parsed.data
  if (configId === null) {
    await clearTaskAssignment(g.tenantId, task)
  } else {
    await setTaskAssignment(g.tenantId, task, configId)
  }

  return NextResponse.json({ ok: true })
}
