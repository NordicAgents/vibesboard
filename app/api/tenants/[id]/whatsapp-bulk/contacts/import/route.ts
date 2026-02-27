import { NextRequest, NextResponse } from 'next/server'
import { importContacts } from '@/lib/whatsapp-bulk/contacts'
import { isFeatureEnabled } from '@/lib/features'
import { requireTenantAdmin } from '@/lib/firebase/route-handler'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ id: string }>
}

/**
 * POST - Import contacts from CSV
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: tenantId } = await params

    const auth = await requireTenantAdmin(tenantId)
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

    if (!body.csvContent) {
      return NextResponse.json(
        { error: 'Missing required field: csvContent' },
        { status: 400 }
      )
    }

    const result = await importContacts({
      tenantId,
      csvContent: body.csvContent,
      listId: body.listId,
      autoOptIn: body.autoOptIn || false,
      userId: auth.user.id,
    })

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Failed to import contacts:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to import contacts' },
      { status: 500 }
    )
  }
}
