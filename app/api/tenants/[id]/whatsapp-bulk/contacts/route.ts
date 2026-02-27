import { NextRequest, NextResponse } from 'next/server'
import {
  createContact,
  listContacts,
} from '@/lib/whatsapp-bulk/contacts'
import { isFeatureEnabled } from '@/lib/features'
import { requireTenantMember } from '@/lib/firebase/route-handler'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ id: string }>
}

/**
 * GET - List contacts for a tenant
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

    const { searchParams } = new URL(request.url)
    const optedIn = searchParams.get('opted_in')
    const search = searchParams.get('search')
    const tags = searchParams.get('tags')?.split(',')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    const result = await listContacts(tenantId, {
      optedIn: optedIn === 'true' ? true : optedIn === 'false' ? false : undefined,
      search: search || undefined,
      tags: tags?.length ? tags : undefined,
      limit,
      offset,
    })

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Failed to list contacts:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to list contacts' },
      { status: 500 }
    )
  }
}

/**
 * POST - Create a new contact
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

    if (!body.phoneNumber) {
      return NextResponse.json(
        { error: 'Missing required field: phoneNumber' },
        { status: 400 }
      )
    }

    const contact = await createContact({
      tenantId,
      phoneNumber: body.phoneNumber,
      name: body.name,
      email: body.email,
      optedIn: body.optedIn || false,
      optInSource: body.optInSource || 'manual',
      customFields: body.customFields,
      tags: body.tags,
    })

    return NextResponse.json({ contact }, { status: 201 })
  } catch (error: any) {
    console.error('Failed to create contact:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create contact' },
      { status: 500 }
    )
  }
}
