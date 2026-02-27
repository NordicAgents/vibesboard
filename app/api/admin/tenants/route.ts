import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { validateTenantSlug, validateTenantName, generateSlug } from '@/lib/validations'

export const runtime = 'nodejs'

/**
 * GET /api/admin/tenants
 * List all tenants (SUPER_ADMIN only)
 */
export async function GET(req: Request) {
    const auth = await requireSuperAdmin()
    if (!auth.ok) return auth.response

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const status = searchParams.get('status')
    const offset = (page - 1) * limit

    // Build query
    let query: FirebaseFirestore.Query = adminDb
        .collection(Collections.tenants)
        .orderBy('createdAt', 'desc')

    if (status && ['active', 'trial', 'suspended'].includes(status)) {
        query = query.where('status', '==', status)
    }

    // Get total count
    const countSnapshot = await query.count().get()
    const total = countSnapshot.data().count

    // Get paginated results
    const snapshot = await query.offset(offset).limit(limit).get()

    const tenants = await Promise.all(
        snapshot.docs.map(async (doc) => {
            const tenant = { id: doc.id, ...doc.data() }

            // Get member count for this tenant
            const membersCount = await adminDb
                .collection(Collections.members(doc.id))
                .count()
                .get()

            return {
                ...tenant,
                user_count: membersCount.data().count
            }
        })
    )

    return NextResponse.json({
        tenants,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    })
}

/**
 * POST /api/admin/tenants
 * Create new tenant (SUPER_ADMIN only)
 */
export async function POST(req: Request) {
    const auth = await requireSuperAdmin()
    if (!auth.ok) return auth.response

    const body = await req.json()
    const { name, slug: providedSlug, created_by } = body

    // Validate input
    if (!name || !validateTenantName(name)) {
        return NextResponse.json(
            { error: 'Invalid tenant name' },
            { status: 400 }
        )
    }

    // Generate or validate slug
    const slug = providedSlug || generateSlug(name)
    if (!validateTenantSlug(slug)) {
        return NextResponse.json(
            { error: 'Invalid tenant slug' },
            { status: 400 }
        )
    }

    const createdBy = created_by || auth.user.id

    // Check if slug already exists
    const slugDoc = await adminDb
        .collection(Collections.tenantSlugs)
        .doc(slug)
        .get()

    if (slugDoc.exists) {
        return NextResponse.json(
            { error: 'Tenant slug already exists' },
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
        status: 'active' as const,
        createdBy,
        isPersonal: false,
        createdAt: now,
        updatedAt: now
    }

    // Use batch to create tenant + slug lock + branding atomically
    const batch = adminDb.batch()

    batch.set(tenantRef, tenantData)

    batch.set(
        adminDb.collection(Collections.tenantSlugs).doc(slug),
        { tenantId, createdAt: now }
    )

    batch.set(
        adminDb.collection(Collections.branding(tenantId)).doc(tenantId),
        {
            tenantId,
            primaryColor: '#000000',
            secondaryColor: '#ffffff',
            createdAt: now,
            updatedAt: now
        }
    )

    await batch.commit()

    return NextResponse.json({ tenant: tenantData }, { status: 201 })
}
