#!/usr/bin/env npx tsx
/**
 * Seed feature flags for direct-booking E2E testing.
 * Also grants super-admin to the first user found (or by email arg).
 *
 * Usage:
 *   npx tsx scripts/seed-booking-e2e.ts
 *   npx tsx scripts/seed-booking-e2e.ts --dry-run
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const DRY_RUN = process.argv.includes('--dry-run')
const TENANT_ID = 'deSAtwrXcbo4KYrVjShr'

// ─── Load env from .env.local ───────────────────────────────────────

function loadEnvKey(key: string): string | undefined {
  try {
    const envPath = resolve(__dirname, '..', '.env.local')
    const content = readFileSync(envPath, 'utf8')
    const prefix = `${key}=`
    const line = content.split('\n').find(l => l.startsWith(prefix))
    if (line) {
      let val = line.slice(prefix.length).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      return val
    }
  } catch {}
  return undefined
}

// ─── Firebase init ──────────────────────────────────────────────────

if (!getApps().length) {
  const saKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || loadEnvKey('FIREBASE_SERVICE_ACCOUNT_KEY')
  if (saKey) {
    initializeApp({ credential: cert(JSON.parse(saKey)) })
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp()
  } else {
    console.error('ERROR: Set FIREBASE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS')
    process.exit(1)
  }
}

const db = getFirestore()

// ─── Feature flags to seed ──────────────────────────────────────────

const FLAGS = [
  { name: 'AGENT_ACTIONS', description: 'Parent flag for agent action features', defaultValue: true },
]

async function seedFlags() {
  console.log(`\n=== Seeding feature flags ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`)

  for (const flag of FLAGS) {
    // Check if flag already exists by name
    const existing = await db.collection('feature_flags')
      .where('name', '==', flag.name)
      .limit(1)
      .get()

    if (!existing.empty) {
      console.log(`  ✓ ${flag.name} already exists (id: ${existing.docs[0].id})`)
      // Ensure tenant toggle exists
      await ensureTenantToggle(existing.docs[0].id, flag.name)
      continue
    }

    const doc = {
      name: flag.name,
      description: flag.description,
      defaultValue: flag.defaultValue,
      createdAt: new Date().toISOString(),
    }

    if (DRY_RUN) {
      console.log(`  [dry] Would create ${flag.name}`)
    } else {
      const ref = await db.collection('feature_flags').add(doc)
      console.log(`  ✓ Created ${flag.name} (id: ${ref.id})`)
      await ensureTenantToggle(ref.id, flag.name)
    }
  }
}

async function ensureTenantToggle(flagId: string, flagName: string) {
  const toggleRef = db
    .collection('tenants')
    .doc(TENANT_ID)
    .collection('feature_toggles')
    .doc(flagId)

  const toggle = await toggleRef.get()
  if (toggle.exists) {
    console.log(`    ✓ Tenant toggle for ${flagName} already exists (enabled: ${toggle.data()?.isEnabled})`)
    return
  }

  const now = new Date().toISOString()
  if (DRY_RUN) {
    console.log(`    [dry] Would enable ${flagName} for tenant ${TENANT_ID}`)
  } else {
    await toggleRef.set({
      tenantId: TENANT_ID,
      featureFlagId: flagId,
      featureFlagName: flagName,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    })
    console.log(`    ✓ Enabled ${flagName} for tenant ${TENANT_ID}`)
  }
}

async function grantSuperAdmin() {
  console.log(`\n=== Granting super-admin ===\n`)

  // Find users in the tenant
  const membersSnap = await db
    .collection('tenants')
    .doc(TENANT_ID)
    .collection('members')
    .limit(5)
    .get()

  if (membersSnap.empty) {
    console.log('  No members found in tenant. Skipping super-admin grant.')
    return
  }

  for (const member of membersSnap.docs) {
    const userId = member.data().userId ?? member.id
    const userDoc = await db.collection('users').doc(userId).get()
    const email = userDoc.data()?.email ?? 'unknown'
    const alreadySuper = userDoc.data()?.isSuperAdmin === true

    if (alreadySuper) {
      console.log(`  ✓ ${email} (${userId}) is already super admin`)
    } else if (DRY_RUN) {
      console.log(`  [dry] Would grant super-admin to ${email} (${userId})`)
    } else {
      await db.collection('users').doc(userId).update({ isSuperAdmin: true })
      console.log(`  ✓ Granted super-admin to ${email} (${userId})`)
    }
  }
}

async function main() {
  await seedFlags()
  await grantSuperAdmin()
  console.log('\nDone!\n')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
