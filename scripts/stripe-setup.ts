/**
 * One-time script to create Stripe Products, Meters, and Prices for VibeAgent plans.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_xxx npx tsx scripts/stripe-setup.ts
 *
 * After running, copy the printed Price IDs into your .env file.
 */

import Stripe from 'stripe'
import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-25.dahlia',
})

// Initialize Firebase Admin for writing Stripe IDs to plan templates
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : null

const app = serviceAccount
  ? initializeApp({ credential: cert(serviceAccount as ServiceAccount) })
  : null
const db = app ? getFirestore(app) : null

async function main() {
  console.log('Creating Stripe products, meters, and prices for VibeAgent...\n')

  // ─── Create Billing Meters (required for metered prices in dahlia+) ──

  const proMeter = await stripe.billing.meters.create({
    display_name: 'VibeAgent Pro Overage Messages',
    event_name: 'vibeagent_pro_overage',
    default_aggregation: { formula: 'sum' },
    customer_mapping: {
      type: 'by_id',
      event_payload_key: 'stripe_customer_id',
    },
    value_settings: {
      event_payload_key: 'message_count',
    },
  })

  const teamMeter = await stripe.billing.meters.create({
    display_name: 'VibeAgent Team Overage Messages',
    event_name: 'vibeagent_team_overage',
    default_aggregation: { formula: 'sum' },
    customer_mapping: {
      type: 'by_id',
      event_payload_key: 'stripe_customer_id',
    },
    value_settings: {
      event_payload_key: 'message_count',
    },
  })

  console.log('Meters:')
  console.log(`  Pro Meter:  ${proMeter.id} (event: vibeagent_pro_overage)`)
  console.log(`  Team Meter: ${teamMeter.id} (event: vibeagent_team_overage)`)
  console.log()

  // ─── Pro Plan ────────────────────────────────────────────────────────

  const proProduct = await stripe.products.create({
    name: 'VibeAgent Pro',
    description: '5,000 messages/month, embed widget, notifications, inbox',
    metadata: { planId: 'pro' },
  })

  const proBasePrice = await stripe.prices.create({
    product: proProduct.id,
    unit_amount: 1900, // $19.00
    currency: 'usd',
    recurring: {
      interval: 'month',
    },
    metadata: { planId: 'pro', type: 'base' },
  })

  const proOveragePrice = await stripe.prices.create({
    product: proProduct.id,
    currency: 'usd',
    recurring: {
      interval: 'month',
      usage_type: 'metered',
      meter: proMeter.id,
    },
    unit_amount: 1, // ~$0.01/msg (Stripe requires integer cents; overage billing
                     // is approximate — use invoice items for exact $0.005/msg)
    billing_scheme: 'per_unit',
    metadata: { planId: 'pro', type: 'overage' },
  })

  console.log('Pro Plan:')
  console.log(`  Product:       ${proProduct.id}`)
  console.log(`  Base Price:    ${proBasePrice.id}  ($19/mo)`)
  console.log(`  Overage Price: ${proOveragePrice.id}  (metered, backed by ${proMeter.id})`)
  console.log()

  // ─── Team Plan ───────────────────────────────────────────────────────

  const teamProduct = await stripe.products.create({
    name: 'VibeAgent Team',
    description: '10,000 messages/seat/month, team collaboration, all channels',
    metadata: { planId: 'team' },
  })

  const teamBasePrice = await stripe.prices.create({
    product: teamProduct.id,
    unit_amount: 1000, // $10.00 per seat
    currency: 'usd',
    recurring: {
      interval: 'month',
    },
    metadata: { planId: 'team', type: 'base' },
  })

  const teamOveragePrice = await stripe.prices.create({
    product: teamProduct.id,
    currency: 'usd',
    recurring: {
      interval: 'month',
      usage_type: 'metered',
      meter: teamMeter.id,
    },
    unit_amount: 1, // ~$0.01/msg (see note above)
    billing_scheme: 'per_unit',
    metadata: { planId: 'team', type: 'overage' },
  })

  console.log('Team Plan:')
  console.log(`  Product:       ${teamProduct.id}`)
  console.log(`  Base Price:    ${teamBasePrice.id}  ($10/seat/mo)`)
  console.log(`  Overage Price: ${teamOveragePrice.id}  (metered, backed by ${teamMeter.id})`)
  console.log()

  // ─── Write Stripe IDs to Firestore plan templates ───────────────────

  if (db) {
    console.log('Writing Stripe IDs to Firestore plan templates...')
    await db.collection('plan_templates').doc('pro').update({
      stripeProductId: proProduct.id,
      stripeBasePriceId: proBasePrice.id,
      stripeOveragePriceId: proOveragePrice.id,
      updatedAt: new Date().toISOString(),
    })
    await db.collection('plan_templates').doc('team').update({
      stripeProductId: teamProduct.id,
      stripeBasePriceId: teamBasePrice.id,
      stripeOveragePriceId: teamOveragePrice.id,
      updatedAt: new Date().toISOString(),
    })
    console.log('  Firestore plan templates updated with Stripe IDs')
    console.log()
  } else {
    console.log('  (Skipping Firestore write — no FIREBASE_SERVICE_ACCOUNT env var)')
    console.log()
  }

  // ─── Summary ─────────────────────────────────────────────────────────

  console.log('─── Add these to your .env file (fallback) ───')
  console.log(`STRIPE_PRICE_PRO_BASE=${proBasePrice.id}`)
  console.log(`STRIPE_PRICE_PRO_OVERAGE=${proOveragePrice.id}`)
  console.log(`STRIPE_PRICE_TEAM_BASE=${teamBasePrice.id}`)
  console.log(`STRIPE_PRICE_TEAM_OVERAGE=${teamOveragePrice.id}`)
}

main().catch((err) => {
  console.error('Failed to set up Stripe:', err)
  process.exit(1)
})
