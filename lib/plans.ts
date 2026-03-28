import type { FeatureFlagName } from './feature-flags'
import type { PlanTemplateDocument } from './firestore-types'

export type PlanId = 'free' | 'pro' | 'team' | 'enterprise'

export interface PlanDefinition {
  id: PlanId
  name: string
  price: number                    // monthly price in cents (0, 1900, 1000, 0)
  pricePerSeat?: number            // cents per seat (Team only: 1000)
  minSeats?: number                // minimum seats (Team only: 3)
  includedMessages: number         // per month (Free: 100, Pro: 5000)
  includedMessagesPerSeat?: number // Team only: 10000/seat
  overageRate: number              // cents per message (0 = hard cap)
  featureFlags: FeatureFlagName[]  // flags enabled for this plan
}

/** Default plan definitions — used as seed data and fallback */
export const DEFAULT_PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    includedMessages: 100,
    overageRate: 0, // hard cap
    featureFlags: ['AGENT_LINKS'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 1900, // $19
    includedMessages: 5000,
    overageRate: 0.5, // $0.005
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
    price: 0, // base is per-seat
    pricePerSeat: 1000, // $10/seat
    minSeats: 3,
    includedMessages: 0, // computed from seats
    includedMessagesPerSeat: 10000,
    overageRate: 0.3, // $0.003
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
    price: 0, // custom
    includedMessages: 0, // custom
    overageRate: 0, // custom
    featureFlags: [], // all flags enabled by override
  },
}

// ─── Firestore-backed plan access (with cache) ─────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const planCache = new Map<string, { data: PlanDefinition; expiresAt: number }>()

function toPlanDefinition(doc: PlanTemplateDocument): PlanDefinition {
  return {
    id: doc.id as PlanId,
    name: doc.name,
    price: doc.price,
    pricePerSeat: doc.pricePerSeat ?? undefined,
    minSeats: doc.minSeats ?? undefined,
    includedMessages: doc.includedMessages,
    includedMessagesPerSeat: doc.includedMessagesPerSeat ?? undefined,
    overageRate: doc.overageRate,
    featureFlags: doc.featureFlags as FeatureFlagName[],
  }
}

/**
 * Get a plan template from Firestore, falling back to DEFAULT_PLANS.
 * Results are cached in-memory for 5 minutes.
 */
export async function getPlanTemplate(planId: PlanId): Promise<PlanDefinition> {
  const cached = planCache.get(planId)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data
  }

  try {
    // Dynamic import to avoid pulling Firebase into client bundles
    const { adminDb } = await import('@/lib/firebase/admin')
    const { Collections } = await import('@/lib/firestore-types')

    const snap = await adminDb
      .collection(Collections.planTemplates)
      .doc(planId)
      .get()

    if (snap.exists) {
      const plan = toPlanDefinition(snap.data() as PlanTemplateDocument)
      planCache.set(planId, { data: plan, expiresAt: Date.now() + CACHE_TTL_MS })
      return plan
    }
  } catch (err: unknown) {
    console.error('[plans] Failed to read plan template from Firestore:', err)
  }

  // Fallback to code defaults
  return DEFAULT_PLANS[planId]
}

/** Get all plan templates from Firestore, falling back to DEFAULT_PLANS. */
export async function getAllPlanTemplates(): Promise<PlanDefinition[]> {
  try {
    const { adminDb } = await import('@/lib/firebase/admin')
    const { Collections } = await import('@/lib/firestore-types')

    const snap = await adminDb.collection(Collections.planTemplates).get()
    if (!snap.empty) {
      return snap.docs.map((d: FirebaseFirestore.QueryDocumentSnapshot) => toPlanDefinition(d.data() as PlanTemplateDocument))
    }
  } catch (err: unknown) {
    console.error('[plans] Failed to read plan templates from Firestore:', err)
  }

  return Object.values(DEFAULT_PLANS)
}

/** Compute the effective message limit for a plan + seat count */
export function computeMessageLimit(plan: PlanDefinition, seatCount: number): number {
  if (plan.includedMessagesPerSeat) {
    return seatCount * plan.includedMessagesPerSeat
  }
  return plan.includedMessages
}
