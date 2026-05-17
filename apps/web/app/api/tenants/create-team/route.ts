import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { requireAuth } from '@/lib/firebase/route-handler'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import {
  validateTenantSlug,
  validateTenantName,
  generateSlug
} from '@/lib/validations'

export const runtime = 'nodejs'

/** Maximum non-personal workspaces a user can create */
const MAX_TEAM_WORKSPACES = 5

/**
 * POST /api/tenants/create-team
 * Create a new team workspace (any authenticated user)
 */
export async function POST(request: Request) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const body = await request.json()
  const { name, slug: providedSlug } = body as {
    name: string
    slug?: string
  }

  // Validate name
  if (!name || !validateTenantName(name)) {
    return NextResponse.json(
      {
        error:
          'Invalid workspace name. Use 2-100 characters with letters, numbers, spaces, hyphens, or underscores.'
      },
      { status: 400 }
    )
  }

  // Generate or validate slug
  const slug = providedSlug || generateSlug(name)
  if (!validateTenantSlug(slug)) {
    return NextResponse.json(
      { error: 'Invalid workspace slug' },
      { status: 400 }
    )
  }

  // Rate limit: check how many non-personal tenants the user owns
  const userDoc = await adminDb
    .collection(Collections.users)
    .doc(auth.user.id)
    .get()

  if (userDoc.exists) {
    const tenantIds: string[] = userDoc.data()?.tenantIds ?? []
    if (tenantIds.length > 0) {
      const tenantDocs = await adminDb
        .collection(Collections.tenants)
        .where('id', 'in', tenantIds.slice(0, 10))
        .where('isPersonal', '==', false)
        .get()

      if (tenantDocs.size >= MAX_TEAM_WORKSPACES) {
        return NextResponse.json(
          {
            error: `You can create a maximum of ${MAX_TEAM_WORKSPACES} team workspaces`
          },
          { status: 429 }
        )
      }
    }
  }

  // Check slug uniqueness
  const slugDoc = await adminDb
    .collection(Collections.tenantSlugs)
    .doc(slug)
    .get()

  if (slugDoc.exists) {
    return NextResponse.json(
      {
        error: 'Workspace slug already exists. Please choose a different name.'
      },
      { status: 409 }
    )
  }

  const now = new Date().toISOString()
  const tenantRef = adminDb.collection(Collections.tenants).doc()
  const tenantId = tenantRef.id

  const tenantData = {
    id: tenantId,
    name,
    slug,
    status: 'pending' as const,
    createdBy: auth.user.id,
    isPersonal: false,
    createdAt: now,
    updatedAt: now
  }

  // Atomic batch write: tenant + slug lock + branding + membership + user update
  const batch = adminDb.batch()

  batch.set(tenantRef, tenantData)

  batch.create(adminDb.collection(Collections.tenantSlugs).doc(slug), {
    tenantId,
    createdAt: now
  })

  batch.set(adminDb.collection(Collections.branding(tenantId)).doc(tenantId), {
    tenantId,
    primaryColor: '#000000',
    secondaryColor: '#ffffff',
    overrides: [],
    createdAt: now,
    updatedAt: now
  })

  // Creator becomes TENANT_ADMIN
  batch.set(
    adminDb.collection(Collections.members(tenantId)).doc(auth.user.id),
    {
      userId: auth.user.id,
      tenantId,
      role: 'TENANT_ADMIN',
      createdAt: now
    }
  )

  // Add to user's tenantIds array
  batch.update(adminDb.collection(Collections.users).doc(auth.user.id), {
    tenantIds: FieldValue.arrayUnion(tenantId)
  })

  await batch.commit()

  return NextResponse.json({ tenant: tenantData }, { status: 201 })
}
