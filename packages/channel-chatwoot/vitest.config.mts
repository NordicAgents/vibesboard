import { fileURLToPath } from 'node:url'
import { defineProject } from 'vitest/config'
import { sharedResolveAlias, sharedTest } from '../../vitest.shared.mts'

export default defineProject({
  resolve: { alias: sharedResolveAlias },
  test: {
    ...sharedTest,
    name: 'channel-chatwoot',
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['src/**/*.test.ts'],
  },
})
