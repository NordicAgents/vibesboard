import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { createTeamWorkspace, MAX_TEAM_WORKSPACES } from '@vibesboard/tenants'
import {
  validateTenantSlug,
  validateTenantName,
  generateSlug
} from '@/lib/validations'

export const runtime = 'nodejs'

/**
 * POST /api/tenants/create-team
 * Create a new team workspace (any authenticated user).
 */
export async function POST(request: Request) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const body = await request.json()
  const { name, slug: providedSlug } = body as { name: string; slug?: string }

  if (!name || !validateTenantName(name)) {
    return NextResponse.json(
      {
        error:
          'Invalid workspace name. Use 2-100 characters with letters, numbers, spaces, hyphens, or underscores.'
      },
      { status: 400 }
    )
  }

  const slug = providedSlug || generateSlug(name)
  if (!validateTenantSlug(slug)) {
    return NextResponse.json(
      { error: 'Invalid workspace slug' },
      { status: 400 }
    )
  }

  const result = await createTeamWorkspace(getMigrateDb(), {
    userId: auth.user.id,
    name,
    slug
  })

  if (!result.ok) {
    if (result.code === 'LIMIT') {
      return NextResponse.json(
        {
          error: `You can create a maximum of ${MAX_TEAM_WORKSPACES} team workspaces`
        },
        { status: 429 }
      )
    }
    return NextResponse.json(
      {
        error: 'Workspace slug already exists. Please choose a different name.'
      },
      { status: 409 }
    )
  }

  return NextResponse.json({ tenant: result.tenant }, { status: 201 })
}
