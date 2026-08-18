import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `LANDING_OPERATOR` is resolved at module scope, so each case re-imports the
// module after setting the environment it wants to observe. Same shape as
// legal-entity.test.ts.
const OPERATOR_KEYS = [
  'NEXT_PUBLIC_OPERATOR_CONTACT_EMAIL',
  'NEXT_PUBLIC_OPERATOR_SOCIAL_X',
  'NEXT_PUBLIC_OPERATOR_SOCIAL_LINKEDIN',
  'NEXT_PUBLIC_OPERATOR_SOCIAL_INSTAGRAM',
  'NEXT_PUBLIC_OPERATOR_SOCIAL_YOUTUBE',
  'NEXT_PUBLIC_OPERATOR_PRODUCTS',
  'NEXT_PUBLIC_OPERATOR_HOSTED_NAME',
  'NEXT_PUBLIC_OPERATOR_HOSTED_URL'
] as const

async function loadModule() {
  vi.resetModules()
  return import('./landing-operator')
}

describe('LANDING_OPERATOR', () => {
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = Object.fromEntries(OPERATOR_KEYS.map(k => [k, process.env[k]]))
    for (const key of OPERATOR_KEYS) delete process.env[key]
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  describe('when nothing is configured', () => {
    it('names nobody at all', async () => {
      const { LANDING_OPERATOR, hasHostedOffering } = await loadModule()

      expect(LANDING_OPERATOR.contactEmail).toBe('')
      expect(LANDING_OPERATOR.socials).toEqual([])
      expect(LANDING_OPERATOR.siblingProducts).toEqual([])
      expect(LANDING_OPERATOR.hostedName).toBe('')
      expect(hasHostedOffering(LANDING_OPERATOR)).toBe(false)
    })

    it('cannot leak the upstream project into any field', async () => {
      // This repository is public. A hardcoded fallback here would put the
      // upstream operator's support address and social accounts onto every
      // fork's landing page.
      const { LANDING_OPERATOR } = await loadModule()
      expect(JSON.stringify(LANDING_OPERATOR)).not.toMatch(/vibesboard/i)
    })
  })

  describe('when configured', () => {
    it('reads the contact address and hosted service', async () => {
      process.env.NEXT_PUBLIC_OPERATOR_CONTACT_EMAIL = 'hi@example.com'
      process.env.NEXT_PUBLIC_OPERATOR_HOSTED_NAME = 'example.com'
      process.env.NEXT_PUBLIC_OPERATOR_HOSTED_URL = 'https://example.com'

      const { LANDING_OPERATOR, hasHostedOffering } = await loadModule()
      expect(LANDING_OPERATOR.contactEmail).toBe('hi@example.com')
      expect(LANDING_OPERATOR.hostedName).toBe('example.com')
      expect(hasHostedOffering(LANDING_OPERATOR)).toBe(true)
    })

    it('lists only the social accounts that were supplied', async () => {
      process.env.NEXT_PUBLIC_OPERATOR_SOCIAL_X = 'https://x.com/example'
      process.env.NEXT_PUBLIC_OPERATOR_SOCIAL_YOUTUBE = 'https://youtube.com/@x'

      const { LANDING_OPERATOR } = await loadModule()
      expect(LANDING_OPERATOR.socials.map(s => s.label)).toEqual([
        'X',
        'YouTube'
      ])
      expect(LANDING_OPERATOR.socials.every(s => s.external)).toBe(true)
    })

    it('trims whitespace rather than rendering an empty link', async () => {
      process.env.NEXT_PUBLIC_OPERATOR_SOCIAL_X = '   '
      const { LANDING_OPERATOR } = await loadModule()
      expect(LANDING_OPERATOR.socials).toEqual([])
    })
  })
})

describe('parseOperatorProducts', () => {
  it('parses label|url pairs separated by commas', async () => {
    const { parseOperatorProducts } = await loadModule()
    expect(
      parseOperatorProducts('Feedback|https://a.example, Org|https://b.example')
    ).toEqual([
      { label: 'Feedback', href: 'https://a.example', external: true },
      { label: 'Org', href: 'https://b.example', external: true }
    ])
  })

  it('drops half-formed entries instead of rendering a dead link', async () => {
    const { parseOperatorProducts } = await loadModule()
    expect(
      parseOperatorProducts('NoUrl,|https://x.example,Good|https://y.example')
    ).toEqual([{ label: 'Good', href: 'https://y.example', external: true }])
  })

  it('returns nothing for an unset or empty value', async () => {
    const { parseOperatorProducts } = await loadModule()
    expect(parseOperatorProducts(undefined)).toEqual([])
    expect(parseOperatorProducts('  ')).toEqual([])
  })
})
