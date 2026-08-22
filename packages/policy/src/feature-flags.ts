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
  'BYO_LLM'
] as const

export type FeatureFlagName = (typeof FEATURE_FLAG_NAMES)[number]

/**
 * Human-readable descriptions shown next to each toggle in the tenant
 * settings "Features" tab. Keyed by flag name.
 */
export const FEATURE_FLAG_DESCRIPTIONS: Record<FeatureFlagName, string> = {
  CUSTOM_BRANDING: 'Customize the logo, colors, and branding of your workspace.',
  TEAM_COLLABORATION: 'Invite team members and collaborate in this workspace.',
  GOOGLE_REVIEW: 'Collect and respond to Google reviews.',
  EMBED_WIDGET: 'Embed an agent as a chat widget on your website.',
  AGENT_LINKS: 'Share public links to your agents.',
  INBOX: 'Inboxes for messaging channels (WhatsApp, Instagram).',
  WHATSAPP_INBOX: 'Receive and reply to WhatsApp conversations.',
  WHATSAPP_INBOX_OAUTH: 'Connect WhatsApp via Meta OAuth.',
  WHATSAPP_INBOX_API_KEY: 'Connect WhatsApp using an API key.',
  WHATSAPP_INBOX_BYOA: 'Bring your own WhatsApp Business account.',
  INSTAGRAM_INBOX: 'Receive and reply to Instagram direct messages.',
  INSTAGRAM_INBOX_OAUTH: 'Connect Instagram via Meta OAuth.',
  INSTAGRAM_INBOX_API_KEY: 'Connect Instagram using an API key.',
  INSTAGRAM_INBOX_BYOA: 'Bring your own Instagram account.',
  CHATWOOT: 'Sync conversations with Chatwoot.',
  AGENT_NOTIFICATIONS: 'Send notifications for agent events.',
  AGENT_NOTIFICATIONS_INAPP: 'Show agent notifications in the app.',
  AGENT_NOTIFICATIONS_EMAIL: 'Send agent notifications by email.',
  AGENT_NOTIFICATIONS_WEBHOOK: 'Send agent notifications to a webhook.',
  AGENT_HANDOFF: 'Hand off conversations from an agent to a human.',
  AGENT_ACTIONS: 'Allow agents to run actions and tools.',
  BYO_LLM: 'Bring your own LLM provider (Anthropic, OpenAI-compatible, etc.).'
}

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
  AGENT_NOTIFICATIONS_WEBHOOK: 'AGENT_NOTIFICATIONS'
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
