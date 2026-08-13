import { describe, it, expect } from 'vitest'
import * as contracts from './index.ts'
import { Collections } from './index.ts'

/**
 * `@vibesboard/contracts` is a pure types + port-interfaces package. Almost
 * everything it exports is type-only (`export type` / `export interface`), so
 * it has NO runtime footprint except a single value: the `Collections` barrel
 * of path constants / path-builder functions.
 *
 * These tests pin the ACTUAL contract:
 *   - the barrel imports without throwing (catches accidental runtime imports
 *     or broken re-export wiring),
 *   - the only runtime export surfaced through the barrel is `Collections`,
 *   - `Collections` is re-exported from the package root (not just from
 *     domain-types).
 *
 * Type-only re-exports are exercised at compile time in `domain-types.test.ts`,
 * `types.test.ts`, `message.test.ts`, and `ports.test.ts` (Vitest compiles each
 * test file, so a broken `export type` would fail those files to load).
 */
describe('@vibesboard/contracts barrel', () => {
  it('imports without throwing and is a module namespace object', () => {
    expect(contracts).toBeTypeOf('object')
    expect(contracts).not.toBeNull()
  })

  it('re-exports the Collections runtime value from the package root', () => {
    expect(contracts.Collections).toBe(Collections)
    expect(Collections).toBeTypeOf('object')
  })

  it('exposes only the expected runtime (value) exports', () => {
    // Type-only re-exports are erased at runtime, so the namespace should carry
    // exactly the real values the package defines. If this changes, a new
    // runtime export was added and must get its own behavioral coverage.
    const runtimeKeys = Object.keys(contracts).filter((k) => k !== '__esModule')
    expect(runtimeKeys.sort()).toEqual(['Collections', 'toPublicAgent'])
  })
})
