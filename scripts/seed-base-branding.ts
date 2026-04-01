#!/usr/bin/env npx tsx
/**
 * Seed the platform base branding document in Firestore.
 * Idempotent — safe to run multiple times (uses set with merge).
 *
 * Usage:
 *   npx tsx scripts/seed-base-branding.ts
 *   npx tsx scripts/seed-base-branding.ts --dry-run
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// ─── Configuration ──────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run')

// ─── Firebase init ───────────────────���──────────────────────────────

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

// ─── Default platform branding ──���───────────────────────────────────

const DEFAULT_PLATFORM_BRANDING = {
  primaryColor: '#000000',
  secondaryColor: '#ffffff',
  logoUrl: null,
}

// ─── Main ─────────────────────────────���─────────────────────────────

async function main() {
  console.log(`\n=== Seed platform base branding ===`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`)
  console.log()

  const ref = db.collection('platform_config').doc('branding')
  const existing = await ref.get()

  if (existing.exists) {
    console.log('  Platform branding document already exists:')
    const data = existing.data()!
    console.log(`    primaryColor:   ${data.primaryColor}`)
    console.log(`    secondaryColor: ${data.secondaryColor}`)
    console.log(`    logoUrl:        ${data.logoUrl || '(none)'}`)
    console.log(`    updatedAt:      ${data.updatedAt}`)
    console.log()
    console.log('  Skipping — document already exists. Delete it manually to re-seed.')
  } else {
    const now = new Date().toISOString()
    const doc = {
      ...DEFAULT_PLATFORM_BRANDING,
      updatedAt: now,
      updatedBy: 'seed-script',
    }

    console.log('  Creating platform branding document:')
    console.log(`    primaryColor:   ${doc.primaryColor}`)
    console.log(`    secondaryColor: ${doc.secondaryColor}`)
    console.log(`    logoUrl:        ${doc.logoUrl || '(none)'}`)

    if (!DRY_RUN) {
      await ref.set(doc)
      console.log('\n  Document created successfully.')
    }
  }

  console.log()
  if (DRY_RUN) {
    console.log(`  DRY RUN — no changes were written.`)
  }
  console.log('Done.')
}

main().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
