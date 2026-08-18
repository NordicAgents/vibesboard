// Per-package Vitest config for @vibesboard/ee-billing.
//
// Same shape as every packages/* config so the root `projects` glob picks it
// up. It resolves to nothing when the `ee/` directory has been removed for a
// community distribution, which is exactly what the glob-not-explicit-path
// comment in the root config describes.
import { fileURLToPath } from 'node:url'
import { defineProject } from 'vitest/config'
import { sharedResolveAlias, sharedTest } from '../../vitest.shared.mts'

export default defineProject({
  resolve: { alias: sharedResolveAlias },
  test: {
    ...sharedTest,
    name: 'ee-billing',
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['src/**/*.test.ts'],
  },
})
