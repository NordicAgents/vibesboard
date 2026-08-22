import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { listTenants, createTenantAsAdmin } from '@vibesboard/tenants'
import {
  validateTenantSlug,
  validateTenantName,
  generateSlug
} from '@/lib/validations'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '10')
  const status = searchParams.get('status') ?? undefined

  const { tenants, total } = await listTenants(getMigrateDb(), {
    page,
    limit,
    status
  })

  return NextResponse.json({
    tenants,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  })
}

export async function POST(req: Request) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const body = await req.json()
  const { name, slug: providedSlug, created_by } = body

  if (!name || !validateTenantName(name)) {
    return NextResponse.json({ error: 'Invalid tenant name' }, { status: 400 })
  }
  const slug = providedSlug || generateSlug(name)
  if (!validateTenantSlug(slug)) {
    return NextResponse.json({ error: 'Invalid tenant slug' }, { status: 400 })
  }

  const result = await createTenantAsAdmin(getMigrateDb(), {
    name,
    slug,
    createdBy: created_by || auth.user.id
  })
  if (!result.ok) {
    return NextResponse.json(
      { error: 'Tenant slug already exists' },
      { status: 409 }
    )
  }

  return NextResponse.json({ tenant: result.tenant }, { status: 201 })
}
