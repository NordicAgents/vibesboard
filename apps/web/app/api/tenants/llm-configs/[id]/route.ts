import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, requireTenantAdmin } from '@/lib/auth/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import { getLlmConfig, updateLlmConfig, deleteLlmConfig } from '@vibesboard/ai/tenant-llm-config'
import { validateProviderBaseUrl } from '@vibesboard/ai/provider-ssrf-guard'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { tenants } from '@vibesboard/adapter-postgres/schema'
import { eq } from 'drizzle-orm'

export const runtime = 'nodejs'

const updateSchema = z
  .object({
    label: z.string().min(1).max(100).optional(),
    kind: z.enum(['openai', 'anthropic', 'openai_compatible', 'google', 'nvidia']).optional(),
    modelId: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
    isEnabled: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'openai_compatible' && v.baseUrl === undefined) {
      ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'baseUrl is required when changing kind to openai_compatible' })
    }
  })

type Params = { params: Promise<{ id: string }> }

async function guardAdminAndFlag(userId: string) {
  const tenantId = await getActiveTenant(userId)
  if (!tenantId) return { ok: false as const, response: NextResponse.json({ error: 'No active tenant' }, { status: 400 }) }

  const adminResult = await requireTenantAdmin(tenantId)
  if (!adminResult.ok) return { ok: false as const, response: adminResult.response }

  const enabled = await isFeatureEnabled(tenantId, 'BYO_LLM')
  if (!enabled) return { ok: false as const, response: NextResponse.json({ error: 'BYO_LLM is not enabled for this workspace' }, { status: 403 }) }

  return { ok: true as const, tenantId }
}

/**
 * GET /api/tenants/llm-configs/[id]
 * Requires TENANT_ADMIN + BYO_LLM flag.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const guard = await guardAdminAndFlag(authResult.user.id)
  if (!guard.ok) return guard.response

  const { id } = await params
  const config = await getLlmConfig(id, guard.tenantId)
  if (!config) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ config })
}

/**
 * PATCH /api/tenants/llm-configs/[id]
 * Requires TENANT_ADMIN + BYO_LLM flag.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const guard = await guardAdminAndFlag(authResult.user.id)
  if (!guard.ok) return guard.response

  const body = await request.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }

  // SSRF check with per-tenant network settings
  if (parsed.data.baseUrl) {
    const [row] = await getMigrateDb()
      .select({ llmAllowPrivateHosts: tenants.llmAllowPrivateHosts, llmHostAllowlist: tenants.llmHostAllowlist })
      .from(tenants).where(eq(tenants.id, guard.tenantId)).limit(1)
    const check = validateProviderBaseUrl(parsed.data.baseUrl, {
      allowPrivateHosts: row?.llmAllowPrivateHosts ?? false,
      hostAllowlist: (row?.llmHostAllowlist ?? []) as string[],
    })
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })
  }

  const { id } = await params
  const config = await updateLlmConfig(id, guard.tenantId, parsed.data)
  if (!config) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ config })
}

/**
 * DELETE /api/tenants/llm-configs/[id]
 * Requires TENANT_ADMIN + BYO_LLM flag.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const guard = await guardAdminAndFlag(authResult.user.id)
  if (!guard.ok) return guard.response

  const { id } = await params
  const deleted = await deleteLlmConfig(id, guard.tenantId)
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return new NextResponse(null, { status: 204 })
}
