#!/usr/bin/env npx tsx
/**
 * Seed plan templates in Firestore from DEFAULT_PLANS constants.
 * Idempotent — safe to run multiple times (uses set with merge).
 *
 * Usage:
 *   npx tsx scripts/seed-plan-templates.ts
 *   npx tsx scripts/seed-plan-templates.ts --dry-run
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

// ─── Plan definitions (copied from lib/plans.ts DEFAULT_PLANS) ──────

const DEFAULT_PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    includedMessages: 100,
    overageRate: 0,
    featureFlags: ['AGENT_LINKS'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 1900,
    includedMessages: 5000,
    overageRate: 0.5,
    featureFlags: [
      'AGENT_LINKS',
      'EMBED_WIDGET',
      'GOOGLE_REVIEW',
      'INBOX',
      'AGENT_NOTIFICATIONS',
      'AGENT_NOTIFICATIONS_INAPP',
      'AGENT_NOTIFICATIONS_EMAIL',
      'AGENT_NOTIFICATIONS_WEBHOOK',
    ],
  },
  team: {
    id: 'team',
    name: 'Team',
    price: 0,
    pricePerSeat: 1000,
    minSeats: 3,
    includedMessages: 0,
    includedMessagesPerSeat: 10000,
    overageRate: 0.3,
    featureFlags: [
      'AGENT_LINKS',
      'EMBED_WIDGET',
      'GOOGLE_REVIEW',
      'INBOX',
      'WHATSAPP_INBOX',
      'INSTAGRAM_INBOX',
      'CHATWOOT',
      'AGENT_NOTIFICATIONS',
      'AGENT_NOTIFICATIONS_INAPP',
      'AGENT_NOTIFICATIONS_EMAIL',
      'AGENT_NOTIFICATIONS_WEBHOOK',
      'TEAM_COLLABORATION',
      'CUSTOM_BRANDING',
    ],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: 0,
    includedMessages: 0,
    overageRate: 0,
    featureFlags: [],
  },
} as const

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Seed plan templates ===`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`)
  console.log()

  const now = new Date().toISOString()

  for (const [planId, plan] of Object.entries(DEFAULT_PLANS)) {
    const doc = {
      ...plan,
      createdAt: now,
      updatedAt: now,
    }

    console.log(`  ${planId}: ${plan.name} — ${plan.includedMessages} msgs, ${plan.featureFlags.length} flags`)

    if (!DRY_RUN) {
      await db.collection('plan_templates').doc(planId).set(doc, { merge: true })
    }
  }

  console.log()
  console.log(`Done. ${Object.keys(DEFAULT_PLANS).length} plan templates seeded.`)

  if (DRY_RUN) {
    console.log(`\n⚠ DRY RUN — no changes were written.`)
  }
}

main().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
