import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, requireTenantAdmin } from '@/lib/auth/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import { listLlmConfigs, createLlmConfig } from '@vibesboard/ai/tenant-llm-config'
import { validateProviderBaseUrl } from '@vibesboard/ai/provider-ssrf-guard'

export const runtime = 'nodejs'

const createSchema = z
  .object({
    label: z.string().min(1).max(100),
    kind: z.enum(['openai', 'anthropic', 'openai_compatible', 'google']),
    modelId: z.string().min(1),
    apiKey: z.string().min(1),
    baseUrl: z.string().url().optional(),
    isDefault: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'openai_compatible' && !v.baseUrl) {
      ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'baseUrl is required for openai_compatible providers' })
    }
    if (v.baseUrl) {
      const check = validateProviderBaseUrl(v.baseUrl)
      if (!check.ok) ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: check.error })
    }
  })

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
 * GET /api/tenants/llm-configs
 * List LLM provider configs. Requires TENANT_ADMIN + BYO_LLM flag.
 */
export async function GET() {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const guard = await guardAdminAndFlag(authResult.user.id)
  if (!guard.ok) return guard.response

  const configs = await listLlmConfigs(guard.tenantId)
  return NextResponse.json({ configs })
}

/**
 * POST /api/tenants/llm-configs
 * Create a new LLM provider config. Requires TENANT_ADMIN + BYO_LLM flag.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const guard = await guardAdminAndFlag(authResult.user.id)
  if (!guard.ok) return guard.response

  const body = await request.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }

  const config = await createLlmConfig(guard.tenantId, parsed.data)
  return NextResponse.json({ config }, { status: 201 })
}
