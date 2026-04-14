import type { IntegrationDefinition } from './types'

export const INTEGRATION_REGISTRY: IntegrationDefinition[] = [
  {
    type: 'embed_widget',
    name: 'Embed Widget',
    description: 'Add a chat widget to any website with a single script tag',
    icon: 'Code2',
    authType: 'custom',
    featureFlag: 'EMBED_WIDGET',
    status: 'available'
  },
  {
    type: 'whatsapp_inbox',
    name: 'WhatsApp Inbox',
    description:
      'Connect your WhatsApp Business Account via OAuth and manage conversations',
    icon: 'Inbox',
    authType: 'oauth',
    featureFlag: 'WHATSAPP_INBOX',
    status: 'available'
  },
  {
    type: 'chatwoot',
    name: 'Chatwoot',
    description:
      'Connect to a Chatwoot inbox to handle customer conversations with your agent',
    icon: 'Headphones',
    authType: 'api_key',
    featureFlag: 'CHATWOOT',
    status: 'available'
  },
  {
    type: 'hooks',
    name: 'API Hooks',
    description:
      'HTTP endpoints for custom integrations via secret-authenticated API',
    icon: 'Webhook',
    authType: 'api_key',
    featureFlag: null,
    status: 'available'
  }
]
