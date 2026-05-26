import { INTEGRATION_REGISTRY } from './registry.ts'
import type { IntegrationDefinition } from './types.ts'

export function getIntegrationByType(
  type: string
): IntegrationDefinition | undefined {
  return INTEGRATION_REGISTRY.find(i => i.type === type)
}

export function getAvailableIntegrations(): IntegrationDefinition[] {
  return INTEGRATION_REGISTRY.filter(i => i.status === 'available')
}

export function getComingSoonIntegrations(): IntegrationDefinition[] {
  return INTEGRATION_REGISTRY.filter(i => i.status === 'coming_soon')
}
