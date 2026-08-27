import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const component = readFileSync(
  fileURLToPath(new URL('./github-star-button.tsx', import.meta.url)),
  'utf8'
)

describe('GitHubStarButton', () => {
  it('renders a plain GitHub repository link without star-count UI', () => {
    expect(component).not.toMatch(/\bStar\b/)
    expect(component).not.toMatch(/formatStarCount/)
    expect(component).not.toMatch(/\bstars\b/)
  })
})
