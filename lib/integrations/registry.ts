import type { IntegrationDefinition } from './types'

export const INTEGRATION_REGISTRY: IntegrationDefinition[] = [
  {
    type: 'whatsapp',
    name: 'WhatsApp',
    description:
      'Connect phone numbers to receive and respond to WhatsApp messages',
    icon: 'MessageCircle',
    authType: 'custom',
    featureFlag: 'WHATSAPP_MESSAGING',
    status: 'available'
  },
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
