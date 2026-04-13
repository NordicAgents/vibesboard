#!/usr/bin/env npx tsx
/**
 * Seed test accounts for each role: SUPER_ADMIN, TENANT_ADMIN, MEMBER.
 *
 * Creates Firebase Auth users + Firestore user/tenant/membership docs.
 * Safe to re-run — skips accounts that already exist.
 *
 * Usage:
 *   npx tsx scripts/seed-test-accounts.ts
 *   npx tsx scripts/seed-test-accounts.ts --dry-run
 *   npx tsx scripts/seed-test-accounts.ts --reset   # deletes & recreates accounts
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const DRY_RUN = process.argv.includes('--dry-run')
const RESET = process.argv.includes('--reset')

// ─── Test account definitions ───────────────────────────────────────

const TEST_TENANT_NAME = 'Test Team Workspace'
const TEST_TENANT_SLUG = 'test-team'

interface TestAccount {
  email: string
  password: string
  displayName: string
  role: 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'MEMBER'
  isSuperAdmin: boolean
}

const ACCOUNTS: TestAccount[] = [
  {
    email: 'superadmin@test.vibeagent.com',
    password: 'TestAdmin123!',
    displayName: 'Super Admin (Test)',
    role: 'SUPER_ADMIN',
    isSuperAdmin: true,
  },
  {
    email: 'tenantadmin@test.vibeagent.com',
    password: 'TestAdmin123!',
    displayName: 'Tenant Admin (Test)',
    role: 'TENANT_ADMIN',
    isSuperAdmin: false,
  },
  {
    email: 'member@test.vibeagent.com',
    password: 'TestMember123!',
    displayName: 'Team Member (Test)',
    role: 'MEMBER',
    isSuperAdmin: false,
  },
]

// ─── Load env from .env.local ───────────────────────────────────────

function loadEnvKey(key: string): string | undefined {
  try {
    const envPath = resolve(__dirname, '..', '.env.local')
    const content = readFileSync(envPath, 'utf8')
    const regex = new RegExp(`^${key}=(.+)`, 'm')
    const match = content.match(regex)
    if (match) {
      let val = match[1].trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      return val
    }
  } catch {}
  return undefined
}

// ─── Firebase init ──────────────────────────────────────────────────

if (!getApps().length) {
  const saKey =
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
    loadEnvKey('FIREBASE_SERVICE_ACCOUNT_KEY')
  if (saKey) {
    initializeApp({ credential: cert(JSON.parse(saKey)) })
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp()
  } else {
    console.error(
      'ERROR: Set FIREBASE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS'
    )
    process.exit(1)
  }
}

const auth = getAuth()
const db = getFirestore()

// ─── Helpers ────────────────────────────────────────────────────────

async function getOrCreateAuthUser(
  account: TestAccount
): Promise<{ uid: string; created: boolean }> {
  try {
    const existing = await auth.getUserByEmail(account.email)
    if (RESET) {
      console.log(`  🗑  Deleting existing auth user ${account.email}...`)
      if (!DRY_RUN) await auth.deleteUser(existing.uid)
      // fall through to create
    } else {
      return { uid: existing.uid, created: false }
    }
  } catch (err: any) {
    if (err.code !== 'auth/user-not-found') throw err
  }

  if (DRY_RUN) {
    console.log(`  [dry] Would create auth user ${account.email}`)
    return { uid: `dry-run-${account.email}`, created: true }
  }

  const user = await auth.createUser({
    email: account.email,
    password: account.password,
    displayName: account.displayName,
    emailVerified: true,
  })
  return { uid: user.uid, created: true }
}

async function ensureTeamTenant(): Promise<string> {
  // Check if test tenant already exists by slug
  const slugDoc = await db.collection('tenant_slugs').doc(TEST_TENANT_SLUG).get()
  if (slugDoc.exists && !RESET) {
    const tenantId = slugDoc.data()!.tenantId
    console.log(`\n  ✓ Test tenant already exists (id: ${tenantId})`)
    return tenantId
  }

  if (slugDoc.exists && RESET) {
    const oldTenantId = slugDoc.data()!.tenantId
    console.log(`  🗑  Deleting existing test tenant ${oldTenantId}...`)
    if (!DRY_RUN) {
      // Delete members subcollection
      const members = await db
        .collection('tenants')
        .doc(oldTenantId)
        .collection('members')
        .get()
      const batch = db.batch()
      members.docs.forEach((d) => batch.delete(d.ref))
      batch.delete(db.collection('tenants').doc(oldTenantId))
      batch.delete(db.collection('tenant_slugs').doc(TEST_TENANT_SLUG))
      await batch.commit()
    }
  }

  if (DRY_RUN) {
    console.log(`  [dry] Would create team tenant "${TEST_TENANT_NAME}"`)
    return 'dry-run-tenant-id'
  }

  const now = new Date().toISOString()
  const tenantRef = db.collection('tenants').doc()
  const tenantId = tenantRef.id

  const batch = db.batch()

  batch.set(tenantRef, {
    id: tenantId,
    name: TEST_TENANT_NAME,
    slug: TEST_TENANT_SLUG,
    status: 'active',
    createdBy: 'seed-script',
    isPersonal: false,
    createdAt: now,
    updatedAt: now,
  })

  batch.set(db.collection('tenant_slugs').doc(TEST_TENANT_SLUG), {
    tenantId,
    createdAt: now,
  })

  // Default branding
  batch.set(
    db
      .collection('tenants')
      .doc(tenantId)
      .collection('branding')
      .doc(tenantId),
    {
      tenantId,
      primaryColor: '#6366f1',
      secondaryColor: '#a5b4fc',
      overrides: [],
      createdAt: now,
      updatedAt: now,
    }
  )

  await batch.commit()
  console.log(`\n  ✓ Created team tenant "${TEST_TENANT_NAME}" (id: ${tenantId})`)
  return tenantId
}

async function patchExistingUser(
  userRef: FirebaseFirestore.DocumentReference,
  data: FirebaseFirestore.DocumentData,
  account: TestAccount,
  tenantId: string
): Promise<void> {
  console.log(`  ✓ User doc for ${account.email} already exists`)
  const needsSuperAdmin = account.isSuperAdmin && !data.isSuperAdmin
  const tenantIds: string[] = data.tenantIds ?? []
  const needsTenant = !tenantIds.includes(tenantId)

  if (DRY_RUN) return

  if (needsSuperAdmin) {
    await userRef.update({ isSuperAdmin: true })
    console.log(`    ↳ Granted super-admin`)
  }
  if (needsTenant) {
    await userRef.update({ tenantIds: [...tenantIds, tenantId] })
    console.log(`    ↳ Added team tenant to tenantIds`)
  }
}

async function ensureUserDoc(
  uid: string,
  account: TestAccount,
  tenantId: string
): Promise<void> {
  const userRef = db.collection('users').doc(uid)
  const existing = await userRef.get()

  if (existing.exists && !RESET) {
    return patchExistingUser(userRef, existing.data()!, account, tenantId)
  }

  if (DRY_RUN) {
    console.log(`  [dry] Would create user doc for ${account.email}`)
    return
  }

  const now = new Date().toISOString()
  await userRef.set({
    id: uid,
    email: account.email,
    name: account.displayName,
    image: '',
    isSuperAdmin: account.isSuperAdmin,
    tenantIds: [tenantId],
    createdAt: now,
    updatedAt: now,
  })
  console.log(`  ✓ Created user doc for ${account.email}`)
}

async function ensureMembership(
  uid: string,
  account: TestAccount,
  tenantId: string
): Promise<void> {
  const memberRef = db
    .collection('tenants')
    .doc(tenantId)
    .collection('members')
    .doc(uid)

  const existing = await memberRef.get()
  if (existing.exists && !RESET) {
    console.log(
      `  ✓ Membership for ${account.email} already exists (role: ${existing.data()?.role})`
    )
    return
  }

  const now = new Date().toISOString()
  if (DRY_RUN) {
    console.log(
      `  [dry] Would create ${account.role} membership for ${account.email}`
    )
    return
  }

  await memberRef.set({
    userId: uid,
    tenantId,
    role: account.role,
    createdAt: now,
  })
  console.log(`  ✓ Created ${account.role} membership for ${account.email}`)
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log(
    `\n=== Seeding test accounts ${DRY_RUN ? '(DRY RUN)' : ''} ${RESET ? '(RESET)' : ''} ===`
  )

  // 1. Create or find the shared team tenant
  console.log('\n--- Team Tenant ---')
  const tenantId = await ensureTeamTenant()

  // 2. Create each account
  for (const account of ACCOUNTS) {
    console.log(`\n--- ${account.role}: ${account.email} ---`)

    const { uid, created } = await getOrCreateAuthUser(account)
    if (created) {
      console.log(`  ✓ Created auth user (uid: ${uid})`)
    } else {
      console.log(`  ✓ Auth user already exists (uid: ${uid})`)
    }

    await ensureUserDoc(uid, account, tenantId)
    await ensureMembership(uid, account, tenantId)
  }

  // 3. Summary
  console.log('\n\n=== Test Accounts Summary ===\n')
  console.log(`Team Tenant: "${TEST_TENANT_NAME}" (slug: ${TEST_TENANT_SLUG})`)
  console.log(`Tenant ID:   ${tenantId}\n`)
  console.log('┌─────────────────────────────────────────────────────────────┐')
  console.log('│ Role          │ Email                           │ Password  │')
  console.log('├─────────────────────────────────────────────────────────────┤')
  for (const a of ACCOUNTS) {
    const role = a.role.padEnd(13)
    const email = a.email.padEnd(31)
    console.log(`│ ${role} │ ${email} │ ${a.password} │`)
  }
  console.log('└─────────────────────────────────────────────────────────────┘')
  console.log('\nDone!\n')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
