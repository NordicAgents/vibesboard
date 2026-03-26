export const FEATURE_FLAG_NAMES = [
  'CUSTOM_BRANDING',
  'TEAM_COLLABORATION',
  'GOOGLE_REVIEW',
  'EMBED_WIDGET',
  'AGENT_LINKS',
  'WHATSAPP_INBOX',
  'INSTAGRAM_INBOX',
  'CHATWOOT'
] as const

export type FeatureFlagName = (typeof FEATURE_FLAG_NAMES)[number]

