import { after, NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { isFeatureEnabled } from '@/lib/features'
import { validateEmail } from '@/lib/validations'
import { randomBytes } from 'crypto'
import { sendInvitationEmail } from '@/lib/email'

export const runtime = 'nodejs'

type RouteParams = {
    params: Promise<{
        id: string
    }>
}

/**
 * GET /api/tenants/[id]/invitations
 * List invitations for a tenant
 */
export async function GET(req: Request, { params }: RouteParams) {
    const { id: tenantId } = await params

    const auth = await requireTenantAdmin(tenantId)
    if (!auth.ok) return auth.response

    const isSuperAdminUser = auth.role === 'SUPER_ADMIN'

    // Block invitation listing for personal workspaces
    const tenantDoc = await adminDb
        .collection(Collections.tenants)
        .doc(tenantId)
        .get()

    if (!tenantDoc.exists) {
        return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
    }

    const tenantData = tenantDoc.data()!
    if (tenantData.isPersonal) {
        return NextResponse.json({ invitations: [] })
    }

    if (!isSuperAdminUser) {
        const teamEnabled = await isFeatureEnabled(tenantId, 'TEAM_COLLABORATION')
        if (!teamEnabled) {
            return NextResponse.json(
                { error: 'Team collaboration is disabled for this workspace' },
                { status: 403 }
            )
        }
    }

    const snapshot = await adminDb
        .collection(Collections.invitations)
        .where('tenantId', '==', tenantId)
        .orderBy('createdAt', 'desc')
        .get()

    const invitations = snapshot.docs.map((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
        const data = doc.data()
        return {
            id: doc.id,
            email: data.email,
            role: data.role,
            status: data.status,
            created_at: data.createdAt,
            expires_at: data.expiresAt,
        }
    })

    return NextResponse.json({ invitations })
}

/**
 * POST /api/tenants/[id]/invitations
 * Create invitation (TENANT_ADMIN)
 */
export async function POST(req: Request, { params }: RouteParams) {
    const { id: tenantId } = await params

    const auth = await requireTenantAdmin(tenantId)
    if (!auth.ok) return auth.response

    const isSuperAdminUser = auth.role === 'SUPER_ADMIN'

    const body = await req.json()
    const { email, role } = body

    // Validate email
    if (!email || !validateEmail(email)) {
        return NextResponse.json(
            { error: 'Invalid email address' },
            { status: 400 }
        )
    }

    const normalizedEmail = String(email).trim().toLowerCase()

    // Validate role
    if (!role || !['TENANT_ADMIN', 'MEMBER'].includes(role)) {
        return NextResponse.json(
            { error: 'Invalid role. Must be TENANT_ADMIN or MEMBER' },
            { status: 400 }
        )
    }

    // Block invitations for personal workspaces
    const tenantDoc = await adminDb
        .collection(Collections.tenants)
        .doc(tenantId)
        .get()

    if (!tenantDoc.exists) {
        return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
    }

    const tenantData = tenantDoc.data()!
    if (tenantData.isPersonal) {
        return NextResponse.json(
            { error: 'Personal workspaces cannot invite members' },
            { status: 403 }
        )
    }

    if (!isSuperAdminUser) {
        const teamEnabled = await isFeatureEnabled(tenantId, 'TEAM_COLLABORATION')
        if (!teamEnabled) {
            return NextResponse.json(
                { error: 'Team collaboration is disabled for this workspace' },
                { status: 403 }
            )
        }
    }

    // Check if user is already a member (by email lookup)
    const membersSnapshot = await adminDb
        .collection(Collections.members(tenantId))
        .get()

    for (const memberDoc of membersSnapshot.docs) {
        const userDoc = await adminDb
            .collection(Collections.users)
            .doc(memberDoc.id)
            .get()

        if (userDoc.exists) {
            const memberEmail = userDoc.data()?.email?.trim().toLowerCase()
            if (memberEmail && memberEmail === normalizedEmail) {
                return NextResponse.json(
                    { error: 'User is already a member of this tenant' },
                    { status: 409 }
                )
            }
        }
    }

    // Check for pending invitation
    const pendingSnapshot = await adminDb
        .collection(Collections.invitations)
        .where('tenantId', '==', tenantId)
        .where('email', '==', normalizedEmail)
        .where('status', '==', 'pending')
        .limit(1)
        .get()

    if (!pendingSnapshot.empty) {
        return NextResponse.json(
            { error: 'Invitation already sent to this email' },
            { status: 409 }
        )
    }

    // Generate secure token
    const token = randomBytes(32).toString('hex')

    // Set expiry (7 days from now)
    const now = new Date()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    // Create invitation — keyed by token for O(1) lookup
    const invitationData = {
        id: token,
        email: normalizedEmail,
        tenantId,
        token,
        role,
        status: 'pending' as const,
        expiresAt: expiresAt.toISOString(),
        createdBy: auth.user.id,
        createdAt: now.toISOString()
    }

    await adminDb
        .collection(Collections.invitations)
        .doc(token)
        .set(invitationData)

    // Build invite URL
    const forwardedProto = req.headers
        .get('x-forwarded-proto')
        ?.split(',')[0]
        ?.trim()
    const forwardedHost = (req.headers.get('x-forwarded-host') ?? req.headers.get('host'))
        ?.split(',')[0]
        ?.trim()

    const origin =
        forwardedProto && forwardedHost
            ? `${forwardedProto}://${forwardedHost}`
            : process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin

    const inviteUrl = `${origin}/invite/${token}`

    // Send invitation email after response (kept alive by next/server after())
    const inviterName = auth.user.name || auth.user.email || 'A team member'
    const tenantName = tenantData.name || 'your team'
    after(
        sendInvitationEmail({
            to: normalizedEmail,
            inviteUrl,
            tenantName,
            inviterName,
            role,
        })
    )

    return NextResponse.json({
        invitation: invitationData,
        inviteUrl,
    }, { status: 201 })
}
