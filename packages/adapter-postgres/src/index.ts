// @vibesboard/adapter-postgres
//
// Import via subpaths, not via this barrel:
//   import { withDb }       from '@vibesboard/adapter-postgres/client'        // server-only
//   import * as schema      from '@vibesboard/adapter-postgres/schema'
//   import { withTenant }   from '@vibesboard/adapter-postgres/tenant-context'
//   import { withTestDb }   from '@vibesboard/adapter-postgres/test-utils'
//
// The barrel is intentionally empty — client.ts is `server-only` and we don't
// want a default import path to drag it into client bundles.

export {}
