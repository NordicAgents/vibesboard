import type { FeatureFlagName } from '@vibesboard/policy/feature-flags'

export type IntegrationAuthType = 'oauth' | 'api_key' | 'custom'
export type IntegrationStatus = 'available' | 'coming_soon'

export interface IntegrationDefinition {
  type: string
  name: string
  description: string
  icon: string
  authType: IntegrationAuthType
  featureFlag: FeatureFlagName | null
  status: IntegrationStatus
}

export interface IntegrationConnectionSummary {
  type: string
  available: boolean
  configured: boolean
  activeConnections?: number
}
