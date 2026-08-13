import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `legalEntity` is resolved at module scope, so each case re-imports the module
// after setting the environment it wants to observe.
const LEGAL_KEYS = [
  'LEGAL_ENTITY_NAME',
  'LEGAL_ENTITY_REGISTRATION_NUMBER',
  'LEGAL_ENTITY_VAT_NUMBER',
  'LEGAL_ENTITY_ADDRESS',
  'LEGAL_GOVERNING_COUNTRY',
  'LEGAL_FORUM',
  'LEGAL_SUPERVISORY_AUTHORITY',
  'LEGAL_SUPERVISORY_AUTHORITY_URL',
  'LEGAL_CONTACT_EMAIL',
  'LEGAL_SERVICE_HOST'
] as const

async function loadModule() {
  vi.resetModules()
  return import('./legal-entity')
}

describe('legalEntity', () => {
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = Object.fromEntries(LEGAL_KEYS.map(k => [k, process.env[k]]))
    for (const key of LEGAL_KEYS) delete process.env[key]
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  describe('when nothing is configured', () => {
    // This repository is public. A default operator would be inherited by every
    // fork, so an unconfigured deployment must name nobody at all.
    it('names no company, address, or identifiers', async () => {
      const { legalEntity, hasOperatorIdentity } = await loadModule()

      expect(legalEntity.name).toBe('')
      expect(legalEntity.registrationNumber).toBe('')
      expect(legalEntity.vatNumber).toBe('')
      expect(legalEntity.address).toEqual([])
      expect(hasOperatorIdentity).toBe(false)
    })

    it('describes the operator neutrally rather than attributing it to anyone', async () => {
      const { formatEntityInline } = await loadModule()

      expect(formatEntityInline()).toBe(
        'the person or company that runs this deployment'
      )
    })

    it('keeps the governing-law clause coherent without naming a country', async () => {
      const { governingLawPhrase, forumPhrase } = await loadModule()

      expect(governingLawPhrase()).toBe(
        'the laws of the country in which the operator is established'
      )
      expect(forumPhrase()).toBe('the competent courts of that country')
    })

    it('points complainants at their own authority', async () => {
      const { supervisoryAuthorityPhrase } = await loadModule()

      expect(supervisoryAuthorityPhrase()).toBe(
        'your local data protection authority'
      )
    })

    it('never leaks a company name into any rendered phrase', async () => {
      const mod = await loadModule()
      const phrases = [
        mod.formatEntityInline(),
        mod.governingLawPhrase(),
        mod.forumPhrase(),
        mod.supervisoryAuthorityPhrase(),
        mod.serviceHostPhrase()
      ].join(' ')

      expect(phrases).not.toMatch(/Nordic|Agents AB|vibesboard\.com|Stockholm/i)
    })
  })

  describe('when an operator configures itself', () => {
    it('reads every field from the environment', async () => {
      process.env.LEGAL_ENTITY_NAME = 'Example Oy'
      process.env.LEGAL_ENTITY_REGISTRATION_NUMBER = '1234567-8'
      process.env.LEGAL_ENTITY_VAT_NUMBER = 'FI12345678'
      process.env.LEGAL_GOVERNING_COUNTRY = 'Finland'
      process.env.LEGAL_FORUM = 'the Helsinki District Court'
      process.env.LEGAL_CONTACT_EMAIL = 'privacy@example.fi'
      process.env.LEGAL_SERVICE_HOST = 'agents.example.fi'

      const { legalEntity, hasOperatorIdentity, governingLawPhrase } =
        await loadModule()

      expect(hasOperatorIdentity).toBe(true)
      expect(legalEntity.name).toBe('Example Oy')
      expect(legalEntity.vatNumber).toBe('FI12345678')
      expect(legalEntity.contactEmail).toBe('privacy@example.fi')
      expect(governingLawPhrase()).toBe('the laws of Finland')
    })

    it('splits the address on "|" and trims each line', async () => {
      process.env.LEGAL_ENTITY_ADDRESS =
        ' Example Street 1 | 111 22 Stockholm |Sweden '

      const { legalEntity } = await loadModule()

      expect(legalEntity.address).toEqual([
        'Example Street 1',
        '111 22 Stockholm',
        'Sweden'
      ])
    })

    it('renders name, identifiers, and address as one inline phrase', async () => {
      process.env.LEGAL_ENTITY_NAME = 'Example AB'
      process.env.LEGAL_ENTITY_REGISTRATION_NUMBER = '556000-0000'
      process.env.LEGAL_ENTITY_VAT_NUMBER = 'SE556000000001'
      process.env.LEGAL_ENTITY_ADDRESS = 'Example Street 1|Sweden'

      const { formatEntityInline } = await loadModule()

      expect(formatEntityInline()).toBe(
        'Example AB (company registration number 556000-0000, VAT SE556000000001), Example Street 1, Sweden'
      )
    })

    it('omits identifiers that are not supplied', async () => {
      process.env.LEGAL_ENTITY_NAME = 'Example AB'
      process.env.LEGAL_ENTITY_ADDRESS = 'Example Street 1|Sweden'

      const { formatEntityInline } = await loadModule()

      expect(formatEntityInline()).toBe('Example AB, Example Street 1, Sweden')
    })

    it('renders a bare name when no address is supplied', async () => {
      process.env.LEGAL_ENTITY_NAME = 'Example AB'

      const { formatEntityInline } = await loadModule()

      expect(formatEntityInline()).toBe('Example AB')
    })

    it('ignores a whitespace-only name instead of claiming an empty operator', async () => {
      process.env.LEGAL_ENTITY_NAME = '   '
      process.env.LEGAL_ENTITY_ADDRESS = ' | |  '

      const { legalEntity, hasOperatorIdentity } = await loadModule()

      expect(legalEntity.name).toBe('')
      expect(legalEntity.address).toEqual([])
      expect(hasOperatorIdentity).toBe(false)
    })
  })
})
