#!/usr/bin/env npx tsx
/**
 * Migrate existing tenants to the free plan.
 *
 * Sets `subscription` on every tenant that doesn't already have one,
 * activating usage metering enforcement.
 *
 * Usage:
 *   npx tsx scripts/migrate-free-plan.ts --dry-run
 *   npx tsx scripts/migrate-free-plan.ts
 *
 * Required environment variables:
 *   FIREBASE_SERVICE_ACCOUNT_KEY — JSON string of Firebase service account key
 *   (or GOOGLE_APPLICATION_CREDENTIALS pointing to a key file)
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// ─── Configuration ──────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run')
const BATCH_SIZE = 400 // Firestore batch limit is 500; stay well below

// ─── Firebase init ──────────────────────────────────────────────────

if (!getApps().length) {
  const saKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
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

const db = getFirestore()

// ─── Billing cycle helpers ──────────────────────────────────────────

function getBillingCycleBoundaries(): {
  billingCycleStart: string
  billingCycleEnd: string
} {
  const now = new Date()
  // Use Date.UTC to avoid local timezone offset
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return {
    billingCycleStart: start.toISOString(),
    billingCycleEnd: end.toISOString(),
  }
}

// ─── Main migration ─────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Migrate tenants to free plan ===`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`)
  console.log()

  const tenantsSnap = await db.collection('tenants').get()
  console.log(`Found ${tenantsSnap.size} total tenants`)

  const { billingCycleStart, billingCycleEnd } = getBillingCycleBoundaries()
  console.log(`Billing cycle: ${billingCycleStart} → ${billingCycleEnd}`)
  console.log()

  let skipped = 0
  let migrated = 0
  let batch = db.batch()
  let batchCount = 0

  for (const doc of tenantsSnap.docs) {
    const data = doc.data()

    if (data.subscription?.planId) {
      console.log(`  SKIP  ${doc.id} (${data.name}) — already has plan: ${data.subscription.planId}`)
      skipped++
      continue
    }

    const subscription = {
      planId: 'free',
      seatCount: 1,
      billingCycleStart,
      billingCycleEnd,
      messageCount: 0,
      messageLimit: 100,
      overageCount: 0,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
      trialEndsAt: null,
    }

    console.log(`  SET   ${doc.id} (${data.name}) → free plan (100 msgs/mo)`)

    if (!DRY_RUN) {
      batch.update(doc.ref, { subscription })
      batchCount++

      if (batchCount >= BATCH_SIZE) {
        await batch.commit()
        console.log(`  ... committed batch of ${batchCount}`)
        batch = db.batch()
        batchCount = 0
      }
    }

    migrated++
  }

  // Commit remaining
  if (!DRY_RUN && batchCount > 0) {
    await batch.commit()
    console.log(`  ... committed final batch of ${batchCount}`)
  }

  console.log()
  console.log(`Done.`)
  console.log(`  Migrated: ${migrated}`)
  console.log(`  Skipped:  ${skipped} (already had subscription)`)
  console.log(`  Total:    ${tenantsSnap.size}`)

  if (DRY_RUN) {
    console.log(`\n⚠ DRY RUN — no changes were written. Run without --dry-run to apply.`)
  }
}

main().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
