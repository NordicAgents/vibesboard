/**
 * Backfill Stripe Price IDs from env vars into Firestore plan templates.
 * For existing deployments that already have Stripe Prices configured
 * via env vars but not yet stored in Firestore.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_xxx \
 *   STRIPE_PRICE_PRO_BASE=price_xxx \
 *   STRIPE_PRICE_PRO_OVERAGE=price_xxx \
 *   STRIPE_PRICE_TEAM_BASE=price_xxx \
 *   STRIPE_PRICE_TEAM_OVERAGE=price_xxx \
 *   FIREBASE_SERVICE_ACCOUNT='{"project_id":"..."}' \
 *   npx tsx scripts/backfill-stripe-ids.ts
 */

import Stripe from 'stripe'
import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-25.dahlia',
})

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!)
const app = initializeApp({ credential: cert(serviceAccount as ServiceAccount) })
const db = getFirestore(app)

interface PlanConfig {
  planId: string
  basePriceEnvVar: string
  overagePriceEnvVar: string
}

const plans: PlanConfig[] = [
  {
    planId: 'pro',
    basePriceEnvVar: 'STRIPE_PRICE_PRO_BASE',
    overagePriceEnvVar: 'STRIPE_PRICE_PRO_OVERAGE',
  },
  {
    planId: 'team',
    basePriceEnvVar: 'STRIPE_PRICE_TEAM_BASE',
    overagePriceEnvVar: 'STRIPE_PRICE_TEAM_OVERAGE',
  },
]

async function main() {
  console.log('Backfilling Stripe IDs from env vars to Firestore plan templates...\n')

  for (const plan of plans) {
    const basePriceId = process.env[plan.basePriceEnvVar]
    const overagePriceId = process.env[plan.overagePriceEnvVar]

    if (!basePriceId || !overagePriceId) {
      console.log(`  Skipping ${plan.planId} — missing env vars`)
      continue
    }

    // Look up the product ID from Stripe
    let productId: string | null = null
    try {
      const price = await stripe.prices.retrieve(basePriceId)
      productId = typeof price.product === 'string' ? price.product : price.product.id
    } catch (err) {
      console.error(`  Failed to retrieve price ${basePriceId}:`, err)
    }

    const ref = db.collection('plan_templates').doc(plan.planId)
    const snap = await ref.get()

    if (!snap.exists) {
      console.log(`  Skipping ${plan.planId} — plan template not found in Firestore`)
      continue
    }

    const existing = snap.data()
    if (existing?.stripeBasePriceId) {
      console.log(`  Skipping ${plan.planId} — already has stripeBasePriceId: ${existing.stripeBasePriceId}`)
      continue
    }

    await ref.update({
      stripeProductId: productId,
      stripeBasePriceId: basePriceId,
      stripeOveragePriceId: overagePriceId,
      updatedAt: new Date().toISOString(),
    })

    console.log(`  ${plan.planId}: product=${productId}, base=${basePriceId}, overage=${overagePriceId}`)
  }

  console.log('\nDone.')
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
