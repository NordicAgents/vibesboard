import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { getTenantDetail, updateTenant, deleteTenant, getTenantBranding } from '@vibesboard/tenants'

export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const db = getMigrateDb()
  const detail = await getTenantDetail(db, id)
  if (!detail) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }
  const branding = await getTenantBranding(db, id)

  return NextResponse.json({ tenant: detail.tenant, branding, user_count: detail.user_count })
}

export async function PUT(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const body = await req.json()
  const { name, slug, status } = body

  if (
    name === undefined &&
    slug === undefined &&
    !(status !== undefined && ['active', 'trial', 'suspended'].includes(status))
  ) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const tenant = await updateTenant(getMigrateDb(), id, { name, slug, status })
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }
  return NextResponse.json({ tenant })
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const deleted = await deleteTenant(getMigrateDb(), id)
  if (!deleted) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }
  return NextResponse.json({ success: true })
}
