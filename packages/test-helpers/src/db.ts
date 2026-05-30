// Thin re-export of the canonical per-schema Postgres test harness so test
// files can depend on a single helpers package rather than reaching into
// adapter-postgres internals. See packages/adapter-postgres/src/test-utils.ts.
export { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
export type { TenantContext } from '@vibesboard/adapter-postgres/types'
