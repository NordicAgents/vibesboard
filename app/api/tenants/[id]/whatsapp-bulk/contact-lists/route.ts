import { NextRequest, NextResponse } from 'next/server'
import {
  createContactList,
  listContactLists,
} from '@/lib/whatsapp-bulk/contacts'
import { isFeatureEnabled } from '@/lib/features'
import { requireTenantMember } from '@/lib/firebase/route-handler'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ id: string }>
}

/**
 * GET - List contact lists for a tenant
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: tenantId } = await params

    const auth = await requireTenantMember(tenantId)
    if (!auth.ok) return auth.response

    // Check if feature is enabled
    const hasAccess = await isFeatureEnabled(tenantId, 'whatsapp_bulk_messaging')
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'WhatsApp Bulk Messaging is not enabled for this tenant' },
        { status: 403 }
      )
    }

    const lists = await listContactLists(tenantId)

    return NextResponse.json({ lists })
  } catch (error: any) {
    console.error('Failed to list contact lists:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to list contact lists' },
      { status: 500 }
    )
  }
}

/**
 * POST - Create a new contact list
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: tenantId } = await params

    const auth = await requireTenantMember(tenantId)
    if (!auth.ok) return auth.response

    // Check if feature is enabled
    const hasAccess = await isFeatureEnabled(tenantId, 'whatsapp_bulk_messaging')
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'WhatsApp Bulk Messaging is not enabled for this tenant' },
        { status: 403 }
      )
    }

    const body = await request.json()

    if (!body.name) {
      return NextResponse.json(
        { error: 'Missing required field: name' },
        { status: 400 }
      )
    }

    const list = await createContactList({
      tenantId,
      name: body.name,
      description: body.description,
      contactIds: body.contactIds,
      userId: auth.user.id,
    })

    return NextResponse.json({ list }, { status: 201 })
  } catch (error: any) {
    console.error('Failed to create contact list:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create contact list' },
      { status: 500 }
    )
  }
}
