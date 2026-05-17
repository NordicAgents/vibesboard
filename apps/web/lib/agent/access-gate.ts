// Re-export shim — access-gate.ts uses next/headers (cookies()) so it
// lives in apps/web/lib/access-gate.ts, NOT in @vibesboard/ai. Consumers'
// '@/lib/agent/access-gate' imports resolve through this shim to the
// apps/web sibling. Deleted in Phase 12.
export * from '@/lib/access-gate'
