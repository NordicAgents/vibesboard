import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import { getLlmConfig, updateLlmConfig, deleteLlmConfig } from '@vibesboard/ai/tenant-llm-config'

export const runtime = 'nodejs'

const updateSchema = z
  .object({
    label: z.string().min(1).max(100).optional(),
    kind: z.enum(['openai', 'anthropic', 'openai_compatible']).optional(),
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

/**
 * GET /api/tenants/llm-configs/[id]
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const tenantId = await getActiveTenant(authResult.user.id)
  if (!tenantId) return NextResponse.json({ error: 'No active tenant' }, { status: 400 })

  const { id } = await params
  const config = await getLlmConfig(id, tenantId)
  if (!config) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ config })
}

/**
 * PATCH /api/tenants/llm-configs/[id]
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const tenantId = await getActiveTenant(authResult.user.id)
  if (!tenantId) return NextResponse.json({ error: 'No active tenant' }, { status: 400 })

  const body = await request.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }

  const { id } = await params
  const config = await updateLlmConfig(id, tenantId, parsed.data)
  if (!config) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ config })
}

/**
 * DELETE /api/tenants/llm-configs/[id]
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const tenantId = await getActiveTenant(authResult.user.id)
  if (!tenantId) return NextResponse.json({ error: 'No active tenant' }, { status: 400 })

  const { id } = await params
  const deleted = await deleteLlmConfig(id, tenantId)
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return new NextResponse(null, { status: 204 })
}
