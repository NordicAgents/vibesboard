import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const readComponent = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8')

describe('landing responsive layout', () => {
  it('keeps the long-form landing sections off phone-sized screens', () => {
    const source = readComponent('landing-page.tsx')

    expect(source).toMatch(
      /className="hidden md:contents"[\s\S]*<LandingQuickstart \/>[\s\S]*<LandingCommunity \/>/
    )
  })

  it('keeps the phone hero focused on one badge and one action', () => {
    const source = readComponent('landing-hero.tsx')

    expect(source).toContain("index > 0 && 'hidden sm:inline-flex'")
    expect(source).toContain('className="sm:hidden"')
    expect(source).toContain('className="hidden sm:inline-flex"')
    expect(source).toContain('className="hidden min-w-0 md:block"')
  })

  it('uses the compact footer on phones', () => {
    const source = readComponent('landing-footer.tsx')

    expect(source).toContain("'hidden gap-10 md:grid lg:gap-8'")
    expect(source).toContain('mt-0 flex flex-col')
  })

  it('does not render the deploy dashboard image at any breakpoint', () => {
    const source = readComponent('landing-deploy.tsx')

    expect(source).not.toContain('LANDING_MEDIA_SHARE_DASHBOARD')
    expect(source).not.toContain('<LandingMedia')
    expect(source).not.toContain('<BrowserFrame')
  })
})
