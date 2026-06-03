import { fileURLToPath } from 'node:url'
import { defineProject } from 'vitest/config'
import { sharedResolveAlias, sharedTest } from '../../vitest.shared.ts'

export default defineProject({
  resolve: { alias: sharedResolveAlias },
  test: {
    ...sharedTest,
    name: 'adapter-openai',
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['src/**/*.test.ts'],
  },
})
