import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import { validateFeatureFlagName } from '@/lib/validations'

export const runtime = 'nodejs'

/**
 * GET /api/admin/feature-flags
 * List all feature flags (SUPER_ADMIN only)
 */
export async function GET() {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const snapshot = await adminDb
    .collection(Collections.featureFlags)
    .orderBy('name', 'asc')
    .get()

  const flags = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }))

  return NextResponse.json({ flags })
}

/**
 * POST /api/admin/feature-flags
 * Create feature flag (SUPER_ADMIN only)
 */
export async function POST(req: Request) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const body = await req.json()
  const { name, description, default_value } = body

  // Validate name
  if (!name || !validateFeatureFlagName(name)) {
    return NextResponse.json(
      { error: 'Invalid feature flag name. Use UPPER_SNAKE_CASE format' },
      { status: 400 }
    )
  }

  // Check if feature flag already exists by name
  const existingSnapshot = await adminDb
    .collection(Collections.featureFlags)
    .where('name', '==', name)
    .limit(1)
    .get()

  if (!existingSnapshot.empty) {
    return NextResponse.json(
      { error: 'Feature flag with this name already exists' },
      { status: 409 }
    )
  }

  const now = new Date().toISOString()
  const flagRef = adminDb.collection(Collections.featureFlags).doc()

  const flagData = {
    id: flagRef.id,
    name,
    description: description ?? '',
    defaultValue: default_value ?? false,
    createdAt: now
  }

  await flagRef.set(flagData)

  return NextResponse.json({ flag: flagData }, { status: 201 })
}
