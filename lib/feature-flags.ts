export const FEATURE_FLAG_NAMES = [
  'CUSTOM_BRANDING',
  'TEAM_COLLABORATION',
  'GOOGLE_REVIEW',
  'EMBED_WIDGET',
  'AGENT_LINKS',
  'INBOX',
  'WHATSAPP_INBOX',
  'INSTAGRAM_INBOX',
  'CHATWOOT'
] as const

export type FeatureFlagName = (typeof FEATURE_FLAG_NAMES)[number]

/**
 * Parent-child hierarchy for feature flags.
 * Maps child flag → parent flag.
 * If a parent is disabled, all children are automatically disabled.
 */
export const FEATURE_FLAG_HIERARCHY: Partial<Record<FeatureFlagName, FeatureFlagName>> = {
  WHATSAPP_INBOX: 'INBOX',
  INSTAGRAM_INBOX: 'INBOX',
}

/** Get the parent flag name for a given flag, or null if it has no parent. */
export function getParentFlag(flagName: FeatureFlagName): FeatureFlagName | null {
  return FEATURE_FLAG_HIERARCHY[flagName] ?? null
}

/** Get all child flag names for a given parent flag. */
export function getChildFlags(flagName: FeatureFlagName): FeatureFlagName[] {
  return (Object.entries(FEATURE_FLAG_HIERARCHY) as [FeatureFlagName, FeatureFlagName][])
    .filter(([, parent]) => parent === flagName)
    .map(([child]) => child)
}
