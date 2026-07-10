import { NextRequest, NextResponse } from 'next/server'
import { generateText } from 'ai'
import { requireAuth, requireTenantAdmin } from '@/lib/auth/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import { getLlmConfig, resolveProviderSpec } from '@vibesboard/ai/tenant-llm-config'
import { buildProviderModel } from '@vibesboard/ai/provider-registry'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/tenants/llm-configs/[id]/test
 * Probe the config with a 1-token generation to verify credentials.
 * Requires TENANT_ADMIN + BYO_LLM flag.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const tenantId = await getActiveTenant(authResult.user.id)
  if (!tenantId) return NextResponse.json({ error: 'No active tenant' }, { status: 400 })

  const adminResult = await requireTenantAdmin(tenantId)
  if (!adminResult.ok) return adminResult.response

  const enabled = await isFeatureEnabled(tenantId, 'BYO_LLM')
  if (!enabled) return NextResponse.json({ error: 'BYO_LLM is not enabled for this workspace' }, { status: 403 })

  const { id } = await params
  const config = await getLlmConfig(id, tenantId)
  if (!config) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const spec = await resolveProviderSpec(tenantId, id)
  if (!spec) return NextResponse.json({ error: 'Could not resolve provider spec' }, { status: 400 })

  try {
    await generateText({
      model: buildProviderModel(spec),
      prompt: 'Reply with the single word: ok',
      maxTokens: 5,
    })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'Unknown error' }, { status: 200 })
  }
}
