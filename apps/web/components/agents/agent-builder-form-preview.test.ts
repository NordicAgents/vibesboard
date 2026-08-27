import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const component = readFileSync(
  fileURLToPath(new URL('./agent-builder-form-preview.tsx', import.meta.url)),
  'utf8'
)

describe('AgentBuilderFormPreview', () => {
  it('places the preview close control in the sidebar header', () => {
    expect(component).toMatch(/onClose && \([\s\S]*aria-label="Hide preview"/)
  })
})
