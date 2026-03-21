import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { requireSuperAdmin } from '@/lib/firebase/route-handler'
import { adminDb, adminAuth } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { validateTenantSlug, validateTenantName, generateSlug } from '@/lib/validations'

/** Try to resolve a userId to an email+name, checking Firestore first, then Firebase Auth. */
async function resolveUserIdentity(userId: string): Promise<{ email: string | null; name: string | null }> {
    // 1. Firestore user doc
    const userDoc = await adminDb.collection(Collections.users).doc(userId).get()
    if (userDoc.exists) {
        const data = userDoc.data()
        if (data?.email) {
            return { email: data.email, name: data.name ?? null }
        }
    }

    // 2. Firebase Auth record (always exists if the user signed in)
    try {
        const authUser = await adminAuth.getUser(userId)
        return { email: authUser.email ?? null, name: authUser.displayName ?? null }
    } catch {
        return { email: null, name: null }
    }
}

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

            // Resolve owner identity: createdBy → first member → give up
            const createdBy = (tenant as any).createdBy
            let identity = { email: null as string | null, name: null as string | null }

            if (createdBy) {
                identity = await resolveUserIdentity(createdBy)
            }

            // Fallback: try the first member if creator lookup failed
            if (!identity.email) {
                const firstMember = await adminDb
                    .collection(Collections.members(doc.id))
                    .limit(1)
                    .get()
                if (!firstMember.empty) {
                    identity = await resolveUserIdentity(firstMember.docs[0].id)
                }
            }

            return {
                ...tenant,
                user_count: membersCount.data().count,
                creator_email: identity.email,
                creator_name: identity.name
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

    // Add the creator as a TENANT_ADMIN member
    batch.set(
        adminDb.collection(Collections.members(tenantId)).doc(createdBy),
        {
            userId: createdBy,
            tenantId,
            role: 'TENANT_ADMIN',
            createdAt: now
        }
    )

    // Update the creator's tenantIds array
    batch.update(
        adminDb.collection(Collections.users).doc(createdBy),
        { tenantIds: FieldValue.arrayUnion(tenantId) }
    )

    await batch.commit()

    return NextResponse.json({ tenant: tenantData }, { status: 201 })
}
