export const FEATURE_FLAG_NAMES = [
  'BETA_ANALYTICS',
  'ADVANCED_TOOLS',
  'CUSTOM_BRANDING',
  'API_ACCESS',
  'TEAM_COLLABORATION',
  'whatsapp_bulk_messaging'
] as const

export type FeatureFlagName = (typeof FEATURE_FLAG_NAMES)[number]

