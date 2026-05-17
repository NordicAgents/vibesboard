// @vibesboard/adapter-stripe
//
// Import via subpath:
//   import { stripe }    from '@vibesboard/adapter-stripe/server'  // server SDK
//   import { getStripe } from '@vibesboard/adapter-stripe/client'  // browser SDK
//
// Separate entrypoints so the server SDK (`stripe` package) stays out of
// client bundles and vice versa.
//
// Phase 5 wraps just the SDK initializers. Business logic that currently
// lives in lib/stripe-helpers.ts, lib/stripe-webhook-handlers.ts, and
// lib/stripe-price-migration.ts is feature code (usage metering, plan sync,
// quota enforcement) and moves into @vibesboard/billing in Phase 9.

export {}
