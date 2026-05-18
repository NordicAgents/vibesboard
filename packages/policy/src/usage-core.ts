/**
 * Self-host shim — re-export the no-op usage functions for any consumer
 * that imported the "core" module historically.
 *
 * The pure rollup field-building helpers (buildRollupUpdateFields,
 * buildRollupSetFields, coerceTokenCount) are no longer needed since
 * recordUsage is a no-op, but they are exported here as stubs so any
 * remaining caller continues to compile.
 */
export {
  logUsage,
  getUsage,
  checkLimit,
  getUsageRollup,
  type UsageSource,
} from './usage.ts'

export type RollupUpdateFields = Record<string, unknown>

/** Coerce a token count to a finite non-negative integer. */
export function coerceTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0
}

/**
 * Build the dot-notation field map for the rollup update() call.
 * Self-host no-op — returns empty object.
 */
export function buildRollupUpdateFields(_params: unknown): RollupUpdateFields {
  return {}
}

/**
 * Build the nested structure for the rollup set() fallback.
 * Self-host no-op — returns empty object.
 */
export function buildRollupSetFields(_params: unknown): Record<string, unknown> {
  return {}
}
