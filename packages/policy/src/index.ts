// @vibesboard/policy — multi-tenant access control + plan/usage metering +
// agent-link CRUD. These four concerns share two properties: (1) zero
// framework deps (no next/headers, no NextResponse, no client SDK), and
// (2) every feature package consumes at least one of them.
//
// Subpath exports per concern so consumers import only what they need:
//
//   import { getUserRole }     from '@vibesboard/policy/permissions'
//   import { isFeatureEnabled} from '@vibesboard/policy/features'
//   import { checkUsageLimit } from '@vibesboard/policy/usage'
//   import { getPlanTemplate} from '@vibesboard/policy/plans'
//
// Note: lib/usage.ts originally contained one NextResponse helper
// (usageLimitResponse). It does NOT move here — it stays at
// apps/web/lib/usage.ts as a shim that re-exports policy/usage and adds
// back the NextResponse wrapper.

export * from './permissions.ts'
export * from './permissions-core.ts'
export * from './feature-flags.ts'
export * from './features.ts'
export * from './usage.ts'
export * from './usage-core.ts'
export * from './plans.ts'
export * from './edition.ts'
export * from './billing.ts'
export * from './agent-links/index.ts'
