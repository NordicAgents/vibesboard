import { describe, it, expect } from 'vitest'
import * as pkg from './index.ts'
import { INTEGRATION_REGISTRY } from './registry.ts'
import {
  getAvailableIntegrations,
  getComingSoonIntegrations,
  getIntegrationByType,
} from './helpers.ts'

describe('package barrel (index.ts)', () => {
  it('re-exports the registry constant', () => {
    expect(pkg.INTEGRATION_REGISTRY).toBe(INTEGRATION_REGISTRY)
  })

  it('re-exports the helper functions', () => {
    expect(pkg.getIntegrationByType).toBe(getIntegrationByType)
    expect(pkg.getAvailableIntegrations).toBe(getAvailableIntegrations)
    expect(pkg.getComingSoonIntegrations).toBe(getComingSoonIntegrations)
  })

  it('exposes the full public surface (no missing or stray runtime exports)', () => {
    expect(Object.keys(pkg).sort()).toEqual([
      'INTEGRATION_REGISTRY',
      'getAvailableIntegrations',
      'getComingSoonIntegrations',
      'getIntegrationByType',
    ])
  })

  it('helpers re-exported via the barrel operate on the re-exported registry', () => {
    expect(pkg.getIntegrationByType('hooks')).toBe(
      pkg.INTEGRATION_REGISTRY.find(i => i.type === 'hooks'),
    )
  })
})
