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
      maxOutputTokens: 5,
    })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    // Return a sanitised error — never echo raw provider response bodies which
    // could exfiltrate internal service content when baseUrl points inward.
    // Some providers (e.g. NVIDIA) return non-OpenAI-shaped error bodies that
    // leave the SDK error message empty, so also check the HTTP status code.
    const raw: string = err?.message ?? ''
    const status: number | undefined = err?.statusCode ?? err?.status
    const sanitised = status === 401 || status === 403 || raw.includes('401') || raw.includes('403') || raw.includes('Unauthorized') || raw.includes('authentication')
      ? 'Authentication failed — check your API key'
      : status === 404 || raw.includes('404') || raw.includes('not found')
      ? 'Model or endpoint not found — check model ID and base URL'
      : 'Connection failed — check your provider settings'
    console.error('[llm-config/test] Provider test error:', raw)
    return NextResponse.json({ ok: false, error: sanitised }, { status: 200 })
  }
}
