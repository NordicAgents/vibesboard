export const FEATURE_FLAG_NAMES = [
  'CUSTOM_BRANDING',
  'TEAM_COLLABORATION',
  'GOOGLE_REVIEW',
  'EMBED_WIDGET',
  'AGENT_LINKS',
  'INBOX',
  'WHATSAPP_INBOX',
  'WHATSAPP_INBOX_OAUTH',
  'WHATSAPP_INBOX_API_KEY',
  'WHATSAPP_INBOX_BYOA',
  'INSTAGRAM_INBOX',
  'INSTAGRAM_INBOX_OAUTH',
  'INSTAGRAM_INBOX_API_KEY',
  'INSTAGRAM_INBOX_BYOA',
  'CHATWOOT',
  'AGENT_NOTIFICATIONS',
  'AGENT_NOTIFICATIONS_INAPP',
  'AGENT_NOTIFICATIONS_EMAIL',
  'AGENT_NOTIFICATIONS_WEBHOOK',
  'AGENT_HANDOFF',
  'AGENT_ACTIONS',
] as const

export type FeatureFlagName = (typeof FEATURE_FLAG_NAMES)[number]

/**
 * Parent-child hierarchy for feature flags.
 * Maps child flag → parent flag.
 * If a parent is disabled, all children are automatically disabled.
 */
export const FEATURE_FLAG_HIERARCHY: Partial<
  Record<FeatureFlagName, FeatureFlagName>
> = {
  WHATSAPP_INBOX: 'INBOX',
  WHATSAPP_INBOX_OAUTH: 'WHATSAPP_INBOX',
  WHATSAPP_INBOX_API_KEY: 'WHATSAPP_INBOX',
  WHATSAPP_INBOX_BYOA: 'WHATSAPP_INBOX',
  INSTAGRAM_INBOX: 'INBOX',
  INSTAGRAM_INBOX_OAUTH: 'INSTAGRAM_INBOX',
  INSTAGRAM_INBOX_API_KEY: 'INSTAGRAM_INBOX',
  INSTAGRAM_INBOX_BYOA: 'INSTAGRAM_INBOX',
  AGENT_NOTIFICATIONS_INAPP: 'AGENT_NOTIFICATIONS',
  AGENT_NOTIFICATIONS_EMAIL: 'AGENT_NOTIFICATIONS',
  AGENT_NOTIFICATIONS_WEBHOOK: 'AGENT_NOTIFICATIONS',
}

/** Get the parent flag name for a given flag, or null if it has no parent. */
export function getParentFlag(
  flagName: FeatureFlagName
): FeatureFlagName | null {
  return FEATURE_FLAG_HIERARCHY[flagName] ?? null
}

/** Get all child flag names for a given parent flag. */
export function getChildFlags(flagName: FeatureFlagName): FeatureFlagName[] {
  return (
    Object.entries(FEATURE_FLAG_HIERARCHY) as [
      FeatureFlagName,
      FeatureFlagName
    ][]
  )
    .filter(([, parent]) => parent === flagName)
    .map(([child]) => child)
}

/** Get all descendant flag names recursively (children, grandchildren, etc.). */
export function getAllDescendants(
  flagName: FeatureFlagName
): FeatureFlagName[] {
  const descendants: FeatureFlagName[] = []
  const children = getChildFlags(flagName)
  for (const child of children) {
    descendants.push(child)
    descendants.push(...getAllDescendants(child))
  }
  return descendants
}

/** Get the depth of a flag in the hierarchy (0 = root, 1 = child, 2 = grandchild). */
export function getFlagDepth(flagName: FeatureFlagName): number {
  let depth = 0
  let current: FeatureFlagName | null = flagName
  while (current && FEATURE_FLAG_HIERARCHY[current]) {
    depth++
    current = FEATURE_FLAG_HIERARCHY[current] ?? null
  }
  return depth
}

/** Get the root ancestor flag (walks up the chain to the topmost parent). */
export function getRootAncestor(flagName: FeatureFlagName): FeatureFlagName {
  let current = flagName
  while (FEATURE_FLAG_HIERARCHY[current]) {
    current = FEATURE_FLAG_HIERARCHY[current]!
  }
  return current
}
