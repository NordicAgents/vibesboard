import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { acceptInvitation } from '@vibesboard/tenants'
import { setActiveTenantId } from '@/lib/tenant-context'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ token: string }>
}

/**
 * POST /api/invitations/[token]/accept
 * Accept invitation (authenticated user).
 */
export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const { token } = await params

  const result = await acceptInvitation(getMigrateDb(), {
    token,
    userId: auth.user.id,
  })

  // Success path first so TypeScript narrows `result` to the ok variant.
  if (result.ok) {
    await setActiveTenantId(result.tenantId)
    return NextResponse.json({ success: true, tenant_id: result.tenantId })
  }

  switch (result.code) {
    case 'NOT_FOUND':
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    case 'EXPIRED':
      return NextResponse.json({ error: 'Invitation has expired' }, { status: 410 })
    case 'ALREADY_ACCEPTED':
      return NextResponse.json(
        { error: 'Invitation has already been accepted' },
        { status: 410 },
      )
    case 'INVALID':
      return NextResponse.json({ error: 'Invitation is no longer valid' }, { status: 410 })
    case 'ALREADY_MEMBER':
      return NextResponse.json(
        { error: 'You are already a member of this tenant' },
        { status: 409 },
      )
    default:
      return NextResponse.json({ error: 'Invitation is no longer valid' }, { status: 410 })
  }
}
