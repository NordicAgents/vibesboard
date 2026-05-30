import { describe, it, expect } from 'vitest'
import { FEATURE_FLAG_NAMES } from '@vibesboard/policy/feature-flags'
import { INTEGRATION_REGISTRY } from './registry.ts'
import type {
  IntegrationAuthType,
  IntegrationStatus,
} from './types.ts'

const AUTH_TYPES: readonly IntegrationAuthType[] = ['oauth', 'api_key', 'custom']
const STATUSES: readonly IntegrationStatus[] = ['available', 'coming_soon']

describe('INTEGRATION_REGISTRY', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(INTEGRATION_REGISTRY)).toBe(true)
    expect(INTEGRATION_REGISTRY.length).toBeGreaterThan(0)
  })

  it('contains exactly the four shipped integrations in order', () => {
    expect(INTEGRATION_REGISTRY.map(i => i.type)).toEqual([
      'embed_widget',
      'whatsapp_inbox',
      'chatwoot',
      'hooks',
    ])
  })

  it('has unique integration types (no duplicate registry entries)', () => {
    const types = INTEGRATION_REGISTRY.map(i => i.type)
    expect(new Set(types).size).toBe(types.length)
  })

  it('has unique display names', () => {
    const names = INTEGRATION_REGISTRY.map(i => i.name)
    expect(new Set(names).size).toBe(names.length)
  })

  describe('every entry has a well-formed shape', () => {
    for (const integration of INTEGRATION_REGISTRY) {
      describe(integration.type, () => {
        it('has all required string fields populated', () => {
          expect(typeof integration.type).toBe('string')
          expect(integration.type.length).toBeGreaterThan(0)
          expect(typeof integration.name).toBe('string')
          expect(integration.name.length).toBeGreaterThan(0)
          expect(typeof integration.description).toBe('string')
          expect(integration.description.length).toBeGreaterThan(0)
          expect(typeof integration.icon).toBe('string')
          expect(integration.icon.length).toBeGreaterThan(0)
        })

        it('uses a valid authType', () => {
          expect(AUTH_TYPES).toContain(integration.authType)
        })

        it('uses a valid status', () => {
          expect(STATUSES).toContain(integration.status)
        })

        it('has a featureFlag that is null or a real policy feature flag', () => {
          if (integration.featureFlag === null) {
            expect(integration.featureFlag).toBeNull()
          } else {
            expect(typeof integration.featureFlag).toBe('string')
            // Guard against drift between the registry and the policy package's
            // canonical flag list — a typo here would silently gate a feature
            // behind a flag that can never be turned on.
            expect(FEATURE_FLAG_NAMES as readonly string[]).toContain(
              integration.featureFlag,
            )
          }
        })
      })
    }
  })

  it('maps each known integration to its expected metadata', () => {
    const byType = new Map(INTEGRATION_REGISTRY.map(i => [i.type, i]))

    expect(byType.get('embed_widget')).toMatchObject({
      name: 'Embed Widget',
      icon: 'Code2',
      authType: 'custom',
      featureFlag: 'EMBED_WIDGET',
      status: 'available',
    })
    expect(byType.get('whatsapp_inbox')).toMatchObject({
      name: 'WhatsApp Inbox',
      icon: 'Inbox',
      authType: 'oauth',
      featureFlag: 'WHATSAPP_INBOX',
      status: 'available',
    })
    expect(byType.get('chatwoot')).toMatchObject({
      name: 'Chatwoot',
      icon: 'Headphones',
      authType: 'api_key',
      featureFlag: 'CHATWOOT',
      status: 'available',
    })
    expect(byType.get('hooks')).toMatchObject({
      name: 'API Hooks',
      icon: 'Webhook',
      authType: 'api_key',
      featureFlag: null,
      status: 'available',
    })
  })

  it('ships every entry as available today (no coming_soon yet)', () => {
    expect(INTEGRATION_REGISTRY.every(i => i.status === 'available')).toBe(true)
  })

  it('only the hooks integration is ungated (featureFlag null)', () => {
    const ungated = INTEGRATION_REGISTRY.filter(i => i.featureFlag === null)
    expect(ungated.map(i => i.type)).toEqual(['hooks'])
  })
})
