# Direct Booking Access Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a warning when Simple Booking is in Direct mode while anonymous chat is enabled, and let admins jump to Setup to protect the agent.

**Architecture:** Put the warning condition and copy in a small pure helper under `lib/agents/` so it can be tested with the existing Node test runner. Pass `allowAnonymous` and a Setup navigation callback from `AgentDashboardTabs` through `AgentActionsFlow` into `AgentBookingResourceConfig`, where the warning is rendered in the Booking Mode card.

**Tech Stack:** TypeScript, React, Next.js app router, Node test runner, existing UI components.

---

## File Structure

- Create: `lib/agents/direct-booking-access-warning.ts` — pure warning copy and visibility decision.
- Create: `lib/agents/direct-booking-access-warning.test.ts` — Node tests for direct/enquiry/anonymous combinations.
- Modify: `components/agents/agent-booking-resource-config.tsx` — render warning and clearer mode labels.
- Modify: `components/agents/agent-actions-flow.tsx` — pass warning inputs into booking settings.
- Modify: `components/agents/agent-dashboard-tabs.tsx` — provide `allowAnonymous` and Setup tab navigation.

## Task 1: Warning Helper

**Files:**

- Create: `lib/agents/direct-booking-access-warning.test.ts`
- Create: `lib/agents/direct-booking-access-warning.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/agents/direct-booking-access-warning.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentBookingConfig } from '../firestore-types.ts'
import {
  DIRECT_BOOKING_ANONYMOUS_WARNING,
  getDirectBookingAccessWarning
} from './direct-booking-access-warning.ts'

function bookingConfig(
  patch: Partial<AgentBookingConfig> = {}
): AgentBookingConfig {
  return {
    enabled: true,
    resources: [
      {
        id: 'resource-1',
        name: 'Glass Cabin',
        calendarConnectionId: 'conn-1',
        calendarId: 'calendar-1',
        calendarName: 'Glass Cabin Bookings',
        timezone: 'Europe/Dublin'
      }
    ],
    mode: 'direct',
    eventTitleTemplate: '{guest_name} ({guest_count} guests)',
    eventTimeMode: 'all-day',
    overlapProtection: true,
    ...patch
  }
}

test('returns warning for enabled direct booking with anonymous chat', () => {
  const warning = getDirectBookingAccessWarning(bookingConfig(), true)

  assert.deepEqual(warning, DIRECT_BOOKING_ANONYMOUS_WARNING)
})

test('returns no warning for enquiry booking with anonymous chat', () => {
  const warning = getDirectBookingAccessWarning(
    bookingConfig({ mode: 'enquiry' }),
    true
  )

  assert.equal(warning, null)
})

test('returns no warning for direct booking when anonymous chat is disabled', () => {
  const warning = getDirectBookingAccessWarning(bookingConfig(), false)

  assert.equal(warning, null)
})

test('returns no warning when booking is disabled', () => {
  const warning = getDirectBookingAccessWarning(
    bookingConfig({ enabled: false }),
    true
  )

  assert.equal(warning, null)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types --test --experimental-test-isolation=none lib/agents/direct-booking-access-warning.test.ts
```

Expected: FAIL because `lib/agents/direct-booking-access-warning.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `lib/agents/direct-booking-access-warning.ts`:

```ts
import type { AgentBookingConfig } from '../firestore-types'

export interface DirectBookingAccessWarning {
  title: string
  message: string
  actionLabel: string
}

export const DIRECT_BOOKING_ANONYMOUS_WARNING: DirectBookingAccessWarning = {
  title: 'Protect direct booking access',
  message:
    'Direct booking can create, edit, list, and cancel calendar events. Anonymous chat is currently enabled, so anyone with the agent link may be able to manage bookings. Turn off anonymous chat in Setup and set an access password before using Direct mode.',
  actionLabel: 'Go to Setup'
}

export function getDirectBookingAccessWarning(
  config: AgentBookingConfig | undefined,
  allowAnonymous: boolean
): DirectBookingAccessWarning | null {
  if (!config?.enabled) return null
  if (config.mode !== 'direct') return null
  if (!allowAnonymous) return null
  return DIRECT_BOOKING_ANONYMOUS_WARNING
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
node --experimental-strip-types --test --experimental-test-isolation=none lib/agents/direct-booking-access-warning.test.ts
```

Expected: PASS.

## Task 2: Render Warning in Booking Settings

**Files:**

- Modify: `components/agents/agent-booking-resource-config.tsx`
- Modify: `components/agents/agent-actions-flow.tsx`
- Modify: `components/agents/agent-dashboard-tabs.tsx`

- [ ] **Step 1: Wire props and warning render**

In `AgentBookingResourceConfig`, add `allowAnonymous` and `onGoToSetup` props, import `AlertTriangle`, and import `getDirectBookingAccessWarning`. Compute `directBookingWarning` from `current` and `allowAnonymous`.

Render the warning inside the Booking Mode card after the mode selector:

```tsx
{
  directBookingWarning && (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-2">
          <div>
            <p className="text-sm font-medium">{directBookingWarning.title}</p>
            <p className="mt-1 text-xs leading-relaxed">
              {directBookingWarning.message}
            </p>
          </div>
          {onGoToSetup && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onGoToSetup}
              disabled={disabled}
              className="border-amber-300 bg-white/70 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-900/30"
            >
              {directBookingWarning.actionLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
```

Update mode labels to:

```tsx
<option value="enquiry">Enquiry - guests submit requests for admin review</option>
<option value="direct">Direct - agent writes calendar events immediately</option>
```

- [ ] **Step 2: Pass state through `AgentActionsFlow`**

Add props:

```ts
allowAnonymous: boolean
onGoToSetup?: () => void
```

Pass them into `AgentBookingResourceConfig`.

- [ ] **Step 3: Pass state from `AgentDashboardTabs`**

In the Actions tab, pass:

```tsx
allowAnonymous={fields.allowAnonymous}
onGoToSetup={() => handleTabChange('setup')}
```

to `AgentActionsFlow`.

- [ ] **Step 4: Type-check**

Run:

```bash
pnpm type-check
```

Expected: PASS.

## Task 3: Formatting and Verification

**Files:**

- Format changed TypeScript and TSX files.

- [ ] **Step 1: Format changed files**

Run:

```bash
pnpm exec prettier --write lib/agents/direct-booking-access-warning.ts lib/agents/direct-booking-access-warning.test.ts components/agents/agent-booking-resource-config.tsx components/agents/agent-actions-flow.tsx components/agents/agent-dashboard-tabs.tsx docs/superpowers/plans/2026-04-26-direct-booking-access-warning.md
```

Expected: files are formatted.

- [ ] **Step 2: Run focused tests**

Run:

```bash
node --experimental-strip-types --test --experimental-test-isolation=none lib/agents/direct-booking-access-warning.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full verification relevant to this change**

Run:

```bash
pnpm type-check
pnpm lint
```

Expected: both PASS.

- [ ] **Step 4: Inspect diff**

Run:

```bash
git diff --stat
git diff -- lib/agents/direct-booking-access-warning.ts lib/agents/direct-booking-access-warning.test.ts components/agents/agent-booking-resource-config.tsx components/agents/agent-actions-flow.tsx components/agents/agent-dashboard-tabs.tsx
```

Expected: diff only includes the warning helper, warning test, and booking UI prop/render changes.
