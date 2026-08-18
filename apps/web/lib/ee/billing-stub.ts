// MIT (community core). Stand-in for `@vibesboard/ee-billing`.
//
// This file is what the specifier `@vibesboard/ee-billing` resolves to when the
// `ee/` directory is not present — a community distribution built after
// `rm -rf ee/`. It is also what TypeScript always resolves the specifier to
// (see the `paths` entry in apps/web/tsconfig.json), which is deliberate: MIT
// code must type-check against an MIT declaration, never against Enterprise
// Edition source.
//
// `null` is a real value here, not a placeholder. apps/web/lib/billing.ts
// treats it as "no enterprise implementation available" and falls back to the
// community one.

import type { IBilling } from '@vibesboard/contracts'

export const enterpriseBilling: IBilling | null = null
