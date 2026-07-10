import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import { listLlmConfigs, createLlmConfig } from '@vibesboard/ai/tenant-llm-config'

export const runtime = 'nodejs'

const createSchema = z
  .object({
    label: z.string().min(1).max(100),
    kind: z.enum(['openai', 'anthropic', 'openai_compatible']),
    modelId: z.string().min(1),
    apiKey: z.string().min(1),
    baseUrl: z.string().url().optional(),
    isDefault: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'openai_compatible' && !v.baseUrl) {
      ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'baseUrl is required for openai_compatible providers' })
    }
  })

/**
 * GET /api/tenants/llm-configs
 * List LLM provider configs for the active tenant.
 */
export async function GET() {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const tenantId = await getActiveTenant(authResult.user.id)
  if (!tenantId) return NextResponse.json({ error: 'No active tenant' }, { status: 400 })

  const configs = await listLlmConfigs(tenantId)
  return NextResponse.json({ configs })
}

/**
 * POST /api/tenants/llm-configs
 * Create a new LLM provider config for the active tenant.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const tenantId = await getActiveTenant(authResult.user.id)
  if (!tenantId) return NextResponse.json({ error: 'No active tenant' }, { status: 400 })

  const body = await request.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }

  const config = await createLlmConfig(tenantId, parsed.data)
  return NextResponse.json({ config }, { status: 201 })
}
