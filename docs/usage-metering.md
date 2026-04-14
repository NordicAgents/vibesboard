# Usage Metering Plan

## Overview

Usage metering tracks every LLM call across all message sources, enforces plan limits, and provides data for billing, dashboards, and audit trails. This document covers the data model, metering pipeline, enforcement, and implementation plan.

---

## Data Model

### Plan Definition

Stored as a code constant (not Firestore) — plans change infrequently and must be versioned with deploys.

```typescript
// lib/plans.ts

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

export const PLANS: Record<PlanId, PlanDefinition> = {
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
```

### Tenant Subscription (Firestore)

Extend `TenantDocument` with subscription fields:

```typescript
// Added to lib/firestore-types.ts

export interface TenantSubscription {
  planId: PlanId
  seatCount: number                   // 1 for Free/Pro, 3+ for Team
  billingCycleStart: string           // ISO date, start of current billing cycle
  billingCycleEnd: string             // ISO date, end of current billing cycle
  messageCount: number                // messages used in current cycle
  messageLimit: number                // computed: plan.includedMessages or seatCount * plan.includedMessagesPerSeat
  overageCount: number                // messages beyond limit in current cycle
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripePriceId: string | null
}
```

**Firestore path:** field on `/tenants/{tenantId}` document (embedded, not subcollection)

### Usage Log (Firestore)

One document per LLM call:

```typescript
// Added to lib/firestore-types.ts

export interface UsageLogDocument {
  id: string
  tenantId: string
  agentId: string
  conversationId: string | null
  userId: string | null               // null for anonymous/public chat
  timestamp: string                   // ISO datetime
  source: UsageSource
  model: string                       // e.g. 'gpt-4o-mini', 'gpt-4o'
  inputTokens: number                 // from API response usage
  outputTokens: number                // from API response usage
  totalTokens: number
  retrievalStrategy: 'direct' | 'rag' | 'bash' | null
  toolCalled: string | null
  latencyMs: number
  billingCycleId: string              // YYYY-MM format for easy querying
}

export type UsageSource =
  | 'chat'           // in-app agent chat
  | 'ask_ai'         // conversation analysis
  | 'public_chat'    // anonymous agent link
  | 'hook_chat'      // hook /chat endpoint
  | 'hook_stream'    // hook /stream endpoint
  | 'hook_async'     // hook /async endpoint
  | 'whatsapp'       // WhatsApp messages
  | 'instagram'      // Instagram messages
  | 'embed'          // embed widget
```

**Firestore path:** `/tenants/{tenantId}/usage_logs/{logId}`

### Monthly Usage Rollup (Firestore)

Aggregated per billing cycle for fast dashboard reads:

```typescript
export interface UsageRollupDocument {
  tenantId: string
  billingCycleId: string              // YYYY-MM
  totalMessages: number
  totalInputTokens: number
  totalOutputTokens: number
  bySource: Record<UsageSource, number>   // message count per source
  byAgent: Record<string, number>         // message count per agentId
  byModel: Record<string, number>         // message count per model
  updatedAt: string
}
```

**Firestore path:** `/tenants/{tenantId}/usage_rollups/{billingCycleId}`

---

## Metering Pipeline

### Step 1: Record Usage at LLM Call

Every LLM call writes a usage log. The hook point is the `onCompletion` callback in `lib/agent/runtime.ts`.

```
User/API Request
  → Chat endpoint (any source)
    → runAgentStream()
      → LLM API call
        → onCompletion callback
          → recordUsage()        // fire-and-forget Firestore write
          → incrementMessageCount() // atomic increment on tenant subscription
```

### Step 2: Increment Tenant Message Counter

Atomic Firestore increment on the tenant's `subscription.messageCount` field. This is the real-time usage counter checked for limit enforcement.

```typescript
// lib/usage.ts

export async function recordUsage(params: {
  tenantId: string
  agentId: string
  conversationId: string | null
  userId: string | null
  source: UsageSource
  model: string
  inputTokens: number
  outputTokens: number
  retrievalStrategy: string | null
  toolCalled: string | null
  latencyMs: number
}): Promise<void> {
  const billingCycleId = getCurrentBillingCycleId(params.tenantId)

  // 1. Write usage log (fire-and-forget)
  const logRef = doc(collection(db, `tenants/${params.tenantId}/usage_logs`))
  setDoc(logRef, {
    id: logRef.id,
    ...params,
    totalTokens: params.inputTokens + params.outputTokens,
    timestamp: new Date().toISOString(),
    billingCycleId,
  }).catch(console.error)

  // 2. Atomic increment on tenant message counter
  updateDoc(doc(db, `tenants/${params.tenantId}`), {
    'subscription.messageCount': FieldValue.increment(1),
  }).catch(console.error)

  // 3. Increment rollup (fire-and-forget)
  const rollupRef = doc(db, `tenants/${params.tenantId}/usage_rollups/${billingCycleId}`)
  setDoc(rollupRef, {
    totalMessages: FieldValue.increment(1),
    totalInputTokens: FieldValue.increment(params.inputTokens),
    totalOutputTokens: FieldValue.increment(params.outputTokens),
    [`bySource.${params.source}`]: FieldValue.increment(1),
    [`byAgent.${params.agentId}`]: FieldValue.increment(1),
    [`byModel.${params.model}`]: FieldValue.increment(1),
    updatedAt: new Date().toISOString(),
  }, { merge: true }).catch(console.error)
}
```

### Step 3: Enforce Limits

Check before every LLM call, not after:

```typescript
// lib/usage.ts

export async function checkUsageLimit(tenantId: string): Promise<{
  allowed: boolean
  remaining: number
  limit: number
  used: number
  planId: PlanId
}> {
  const tenant = await getTenant(tenantId)
  const { subscription } = tenant
  const plan = PLANS[subscription.planId]

  const limit = subscription.messageLimit
  const used = subscription.messageCount
  const remaining = Math.max(0, limit - used)

  // Free plan: hard cap
  if (plan.overageRate === 0 && used >= limit) {
    return { allowed: false, remaining: 0, limit, used, planId: plan.id }
  }

  // Paid plans: always allowed (overage billed)
  return { allowed: true, remaining, limit, used, planId: plan.id }
}
```

### Step 4: Billing Cycle Reset

A scheduled Cloud Function (or cron) runs at each tenant's billing cycle end:

1. Snapshot final `messageCount` and `overageCount`
2. Report overage to Stripe as metered usage
3. Reset `messageCount` to 0 and `overageCount` to 0
4. Advance `billingCycleStart` and `billingCycleEnd`

---

## Message Sources — Where to Instrument

Each chat endpoint needs a `recordUsage()` call in its completion path:

| Endpoint | File | Source Value |
|---|---|---|
| Agent chat | `app/api/agents/[id]/chat/route.ts` | `chat` |
| Ask AI | `app/api/agents/[id]/conversations/ask/route.ts` | `ask_ai` |
| Public chat | `app/api/public/agents/[agentId]/chat/route.ts` | `public_chat` |
| Hook chat | `app/api/hooks/[hookId]/chat/route.ts` | `hook_chat` |
| Hook stream | `app/api/hooks/[hookId]/stream/route.ts` | `hook_stream` |
| Hook async | `app/api/hooks/[hookId]/async/route.ts` | `hook_async` |
| General chat | `app/api/chat/route.ts` | `chat` |

**Ideal approach:** Instrument once in `lib/agent/runtime.ts` `onCompletion` callback, passing `source` as a parameter through `runAgentStream()`. This avoids duplicating metering logic across endpoints.

---

## Limit Enforcement Flow

```
Incoming request
  │
  ├─ checkUsageLimit(tenantId)
  │   ├─ allowed: true  → proceed to LLM call
  │   └─ allowed: false → return 429 with upgrade prompt
  │
  ├─ runAgentStream() → LLM call
  │
  └─ onCompletion
      └─ recordUsage() (fire-and-forget)
```

### Error Responses

**Free plan at limit (429):**
```json
{
  "error": "usage_limit_reached",
  "message": "You've used all 100 messages this month. Upgrade to Pro for 5,000 messages/month.",
  "used": 100,
  "limit": 100,
  "upgradeUrl": "/settings/billing"
}
```

**Paid plan overage (200 with warning header):**
```
X-Usage-Warning: overage
X-Usage-Remaining: -150
X-Usage-Limit: 5000
```

---

## Stripe Integration

### Subscription Management

| Plan | Stripe Product | Billing |
|---|---|---|
| Free | No Stripe object | No billing |
| Pro | Fixed-price subscription ($19/mo) | Monthly recurring |
| Team | Per-seat subscription ($10/seat/mo) | Monthly recurring, quantity = seat count |
| Enterprise | Custom invoice | Manual |

### Overage Billing

Use Stripe's **metered billing** (usage records):

1. At billing cycle end, calculate: `overageCount = max(0, messageCount - messageLimit)`
2. Report `overageCount` to Stripe via `stripe.subscriptionItems.createUsageRecord()`
3. Stripe adds overage charge to next invoice: `overageCount × overageRate`

### Webhook Events to Handle

| Event | Action |
|---|---|
| `customer.subscription.created` | Set tenant plan, activate features |
| `customer.subscription.updated` | Update plan/seats, recalculate limits |
| `customer.subscription.deleted` | Downgrade to Free, disable gated features |
| `invoice.payment_succeeded` | Reset billing cycle, clear overage |
| `invoice.payment_failed` | Grace period → suspend tenant |

---

## Dashboard & Reporting

### Tenant-Facing (Settings → Usage)

- Current cycle usage bar: `messageCount / messageLimit`
- Usage by source (pie chart): chat, hooks, WhatsApp, etc.
- Usage by agent (bar chart): top agents by message count
- Daily usage trend (line chart): messages per day in current cycle
- Overage indicator and cost estimate

### Admin-Facing (Admin → Tenants)

- Per-tenant usage overview
- Aggregated platform usage
- Revenue metrics: MRR, overage revenue, conversion rates
- Tenant health: approaching limits, suspended, trial expiring

---

## Implementation Phases

### Phase 1: Core Metering (Priority: High)

1. Define `PlanDefinition` and `PLANS` constant in `lib/plans.ts`
2. Add `TenantSubscription` to `TenantDocument` in `lib/firestore-types.ts`
3. Add `UsageLogDocument` interface to `lib/firestore-types.ts`
4. Create `lib/usage.ts` with `recordUsage()` and `checkUsageLimit()`
5. Instrument `lib/agent/runtime.ts` `onCompletion` to call `recordUsage()`
6. Add `checkUsageLimit()` guard to all chat endpoints
7. Migrate existing tenants: set `planId: 'free'`, initialize counters

### Phase 2: Stripe Integration (Priority: High)

1. Add `stripe` package, configure env vars (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`)
2. Create Stripe products and prices for Pro and Team plans
3. Build `/api/stripe/checkout` — create Stripe Checkout session
4. Build `/api/stripe/webhook` — handle Stripe webhook events
5. Build `/api/stripe/portal` — redirect to Stripe Customer Portal
6. Create billing cycle reset Cloud Function (daily cron)

### Phase 3: Billing UI (Priority: Medium)

1. Add "Billing" tab to Settings page
2. Build plan selector / upgrade flow component
3. Build usage dashboard with charts
4. Add usage warnings in chat UI (approaching limit, at limit)
5. Add upgrade prompts when limit is reached

### Phase 4: Admin & Reporting (Priority: Low)

1. Add usage columns to admin tenant list
2. Build admin usage analytics dashboard
3. Add monthly usage rollup aggregation
4. Export usage reports (CSV)

---

## Firestore Security Rules

```
// Usage logs: read by tenant admins, write by server only
match /tenants/{tenantId}/usage_logs/{logId} {
  allow read: if isTenantAdmin(tenantId);
  allow write: if false; // server-side only via Admin SDK
}

// Usage rollups: read by tenant admins, write by server only
match /tenants/{tenantId}/usage_rollups/{cycleId} {
  allow read: if isTenantAdmin(tenantId);
  allow write: if false;
}
```

---

## Key Design Decisions

1. **Messages, not tokens** — Billing unit is messages (LLM calls), not tokens. Simpler for users to understand. Token data is still logged for internal cost analysis.
2. **Fire-and-forget writes** — Usage logging must not block the chat response. All Firestore writes are async, errors are logged but don't fail the request.
3. **Atomic counters** — `messageCount` uses `FieldValue.increment()` to avoid race conditions under concurrent requests.
4. **Pre-check enforcement** — Limits are checked before the LLM call, not after. This prevents a free user from getting one extra message by racing the counter.
5. **Plans in code, not Firestore** — Plan definitions are constants deployed with the app. This prevents accidental plan changes and ensures consistency across servers.
6. **Rollups for dashboards** — Individual usage logs are for audit/billing. Rollup documents are for fast dashboard reads without expensive aggregation queries.
