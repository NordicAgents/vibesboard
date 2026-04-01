#!/usr/bin/env npx tsx
/**
 * Seed BYOA feature flags in Firestore.
 * Idempotent — safe to run multiple times (uses set with merge).
 *
 * Usage:
 *   npx tsx scripts/seed-byoa-feature-flags.ts
 *   npx tsx scripts/seed-byoa-feature-flags.ts --dry-run
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// ─── Configuration ──────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run')

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

// ─── New BYOA feature flags ────────────────────────────────────────

const FLAGS = [
  {
    name: 'WHATSAPP_INBOX_OAUTH',
    description: 'Allow connecting WhatsApp via OAuth flow',
    defaultValue: true,
  },
  {
    name: 'WHATSAPP_INBOX_API_KEY',
    description: 'Allow connecting WhatsApp via API Key',
    defaultValue: true,
  },
  {
    name: 'WHATSAPP_INBOX_BYOA',
    description: 'Allow connecting WhatsApp via Bring Your Own App',
    defaultValue: false,
  },
  {
    name: 'INSTAGRAM_INBOX_OAUTH',
    description: 'Allow connecting Instagram via OAuth flow',
    defaultValue: true,
  },
  {
    name: 'INSTAGRAM_INBOX_API_KEY',
    description: 'Allow connecting Instagram via API Key',
    defaultValue: true,
  },
  {
    name: 'INSTAGRAM_INBOX_BYOA',
    description: 'Allow connecting Instagram via Bring Your Own App',
    defaultValue: false,
  },
]

// ─── Seed ───────────────────────────────────────────────────────────

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN — no writes\n' : '🚀 Seeding feature flags...\n')

  for (const flag of FLAGS) {
    const col = db.collection('feature_flags')
    const existing = await col.where('name', '==', flag.name).limit(1).get()

    if (!existing.empty) {
      console.log(`  ⏭  ${flag.name} — already exists (${existing.docs[0].id})`)
      continue
    }

    const docRef = col.doc()
    const doc = {
      id: docRef.id,
      name: flag.name,
      description: flag.description,
      defaultValue: flag.defaultValue,
      createdAt: new Date().toISOString(),
    }

    if (DRY_RUN) {
      console.log(`  📝 Would create: ${flag.name} (${docRef.id})`)
    } else {
      await docRef.set(doc)
      console.log(`  ✅ Created: ${flag.name} (${docRef.id})`)
    }
  }

  console.log('\nDone.')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
