import { NextRequest, NextResponse } from 'next/server'
import {
  createMessageTemplate,
  listTemplates,
  validateTemplate,
} from '@/lib/whatsapp-bulk/templates'
import { requireAuth } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ accountId: string }>
}

/**
 * Find the tenantId that owns this business account using collectionGroup query.
 */
async function findTenantForAccount(accountId: string): Promise<string | null> {
  const snap = await adminDb
    .collectionGroup('whatsapp_business_accounts')
    .where('id', '==', accountId)
    .limit(1)
    .get()

  if (snap.empty) return null

  // Path: tenants/{tenantId}/whatsapp_business_accounts/{accountId}
  const pathParts = snap.docs[0].ref.path.split('/')
  return pathParts[1]
}

/**
 * GET - List templates for a business account
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { accountId } = await params

    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    // Verify account exists and user has access
    const tenantId = await findTenantForAccount(accountId)
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Business account not found' },
        { status: 404 }
      )
    }

    // Verify user is a member of this tenant
    const memberDoc = await adminDb
      .collection(`tenants/${tenantId}/members`)
      .doc(auth.user.id)
      .get()

    if (!memberDoc.exists) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') as 'pending' | 'approved' | 'rejected' | undefined

    const templates = await listTemplates(tenantId, accountId, status)

    return NextResponse.json({ templates })
  } catch (error: any) {
    console.error('Failed to list templates:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to list templates' },
      { status: 500 }
    )
  }
}

/**
 * POST - Create a new template
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { accountId } = await params

    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    // Verify account exists and user has access
    const tenantId = await findTenantForAccount(accountId)
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Business account not found' },
        { status: 404 }
      )
    }

    // Verify user is a member of this tenant
    const memberDoc = await adminDb
      .collection(`tenants/${tenantId}/members`)
      .doc(auth.user.id)
      .get()

    if (!memberDoc.exists) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      )
    }

    const body = await request.json()

    // Validate template before submission
    const validation = validateTemplate({
      businessAccountId: accountId,
      ...body,
    })

    if (!validation.isValid) {
      return NextResponse.json(
        {
          error: 'Template validation failed',
          validationErrors: validation.errors,
        },
        { status: 400 }
      )
    }

    const template = await createMessageTemplate(tenantId, {
      businessAccountId: accountId,
      name: body.name,
      category: body.category,
      language: body.language || 'en',
      bodyText: body.bodyText,
      headerType: body.headerType,
      headerText: body.headerText,
      headerMediaUrl: body.headerMediaUrl,
      footerText: body.footerText,
      variables: body.variables,
      buttons: body.buttons,
    })

    return NextResponse.json({ template }, { status: 201 })
  } catch (error: any) {
    console.error('Failed to create template:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create template' },
      { status: 500 }
    )
  }
}
