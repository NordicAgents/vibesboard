import { describe, it, expect } from 'vitest'
import {
  getAvailableIntegrations,
  getComingSoonIntegrations,
  getIntegrationByType,
} from './helpers.ts'
import { INTEGRATION_REGISTRY } from './registry.ts'

describe('getIntegrationByType', () => {
  it('returns the matching definition for a known type', () => {
    const result = getIntegrationByType('chatwoot')
    expect(result).toBeDefined()
    expect(result?.type).toBe('chatwoot')
    expect(result?.name).toBe('Chatwoot')
  })

  it('returns the exact same object reference held in the registry', () => {
    const result = getIntegrationByType('embed_widget')
    const fromRegistry = INTEGRATION_REGISTRY.find(i => i.type === 'embed_widget')
    expect(result).toBe(fromRegistry)
  })

  it('resolves every registered type', () => {
    for (const integration of INTEGRATION_REGISTRY) {
      expect(getIntegrationByType(integration.type)).toBe(integration)
    }
  })

  it('returns undefined for an unknown type', () => {
    expect(getIntegrationByType('does_not_exist')).toBeUndefined()
  })

  it('returns undefined for an empty string', () => {
    expect(getIntegrationByType('')).toBeUndefined()
  })

  it('is case-sensitive (does not match on differing case)', () => {
    expect(getIntegrationByType('CHATWOOT')).toBeUndefined()
    expect(getIntegrationByType('Chatwoot')).toBeUndefined()
  })

  it('does not match on a whitespace-padded type', () => {
    expect(getIntegrationByType(' chatwoot ')).toBeUndefined()
  })

  it('does not return prototype-pollution lookups (e.g. constructor)', () => {
    // `.find` over an array never resolves prototype keys to an entry, but
    // assert it explicitly so a future Map/object-keyed refactor stays safe.
    expect(getIntegrationByType('constructor')).toBeUndefined()
    expect(getIntegrationByType('__proto__')).toBeUndefined()
    expect(getIntegrationByType('toString')).toBeUndefined()
  })
})

describe('getAvailableIntegrations', () => {
  it('returns only entries with status "available"', () => {
    const available = getAvailableIntegrations()
    expect(available.length).toBeGreaterThan(0)
    expect(available.every(i => i.status === 'available')).toBe(true)
  })

  it('currently returns all four registry entries (none are coming_soon)', () => {
    expect(getAvailableIntegrations().map(i => i.type)).toEqual([
      'embed_widget',
      'whatsapp_inbox',
      'chatwoot',
      'hooks',
    ])
  })

  it('returns a fresh array, not the registry instance (filter copy)', () => {
    expect(getAvailableIntegrations()).not.toBe(INTEGRATION_REGISTRY)
  })

  it('mutating the returned array does not affect the registry', () => {
    const before = INTEGRATION_REGISTRY.length
    const available = getAvailableIntegrations()
    available.pop()
    expect(INTEGRATION_REGISTRY.length).toBe(before)
    expect(getAvailableIntegrations().length).toBe(before)
  })
})

describe('getComingSoonIntegrations', () => {
  it('returns only entries with status "coming_soon"', () => {
    expect(getComingSoonIntegrations().every(i => i.status === 'coming_soon')).toBe(
      true,
    )
  })

  it('returns an empty array today (nothing is coming_soon yet)', () => {
    expect(getComingSoonIntegrations()).toEqual([])
  })

  it('returns a fresh array, not the registry instance', () => {
    expect(getComingSoonIntegrations()).not.toBe(INTEGRATION_REGISTRY)
  })
})

describe('available + coming_soon partition the registry', () => {
  it('together cover every registry entry with no overlap', () => {
    const available = getAvailableIntegrations()
    const comingSoon = getComingSoonIntegrations()
    expect(available.length + comingSoon.length).toBe(INTEGRATION_REGISTRY.length)

    const overlap = available.filter(a => comingSoon.some(c => c.type === a.type))
    expect(overlap).toEqual([])
  })
})
