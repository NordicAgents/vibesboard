import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireAuth, requireTenantAdmin } from '@/lib/auth/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import { withDb, type DbTx } from '@vibesboard/adapter-postgres/client'
import { withTenant } from '@vibesboard/adapter-postgres/tenant-context'
import { tenants } from '@vibesboard/adapter-postgres/schema'

export const runtime = 'nodejs'

function withNetworkDb<T>(
  tenantId: string,
  work: (db: DbTx) => Promise<T> | T
) {
  return withTenant({ tenantId, userId: null, isSuperAdmin: false }, () =>
    withDb(work)
  )
}

const updateSchema = z.object({
  llmAllowPrivateHosts: z.boolean().optional(),
  llmHostAllowlist: z.array(z.string().min(1).max(253)).max(20).optional()
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
 * GET /api/tenants/llm-configs/network
 * Return the tenant's LLM network access settings.
 */
export async function GET() {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response
  const g = await guard(authResult.user.id)
  if (!g.ok) return g.response

  const [row] = await withNetworkDb(g.tenantId, db =>
    db
      .select({
        llmAllowPrivateHosts: tenants.llmAllowPrivateHosts,
        llmHostAllowlist: tenants.llmHostAllowlist
      })
      .from(tenants)
      .where(eq(tenants.id, g.tenantId))
      .limit(1)
  )

  return NextResponse.json({
    llmAllowPrivateHosts: row?.llmAllowPrivateHosts ?? false,
    llmHostAllowlist: row?.llmHostAllowlist ?? []
  })
}

/**
 * PATCH /api/tenants/llm-configs/network
 * Update LLM network access settings. Requires TENANT_ADMIN + BYO_LLM.
 */
export async function PATCH(request: NextRequest) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response
  const g = await guard(authResult.user.id)
  if (!g.ok) return g.response

  const body = await request.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (parsed.data.llmAllowPrivateHosts !== undefined)
    patch.llmAllowPrivateHosts = parsed.data.llmAllowPrivateHosts
  if (parsed.data.llmHostAllowlist !== undefined)
    patch.llmHostAllowlist = parsed.data.llmHostAllowlist

  await withNetworkDb(g.tenantId, db =>
    db.update(tenants).set(patch).where(eq(tenants.id, g.tenantId))
  )

  return NextResponse.json({ ok: true })
}
