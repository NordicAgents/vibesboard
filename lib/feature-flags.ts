export const FEATURE_FLAG_NAMES = [
  'CUSTOM_BRANDING',
  'TEAM_COLLABORATION',
  'whatsapp_bulk_messaging',
  'WHATSAPP_MESSAGING',
  'GOOGLE_REVIEW',
  'EMBED_WIDGET',
  'AGENT_LINKS',
  'WHATSAPP_INBOX'
] as const

export type FeatureFlagName = (typeof FEATURE_FLAG_NAMES)[number]

