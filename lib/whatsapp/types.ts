// WhatsApp Integration Types
// Re-exports Firestore document types with camelCase field names

import type {
  WhatsAppConnectionStatus,
  WhatsAppAgentConnectionDocument,
  AgentDocument,
} from '@/lib/firestore-types'

export type { WhatsAppConnectionStatus }

export type WhatsAppAgentConnection = WhatsAppAgentConnectionDocument

export interface CreateConnectionParams {
  agentId: string
  phoneNumber: string
  customIntroMessage?: string
  sendIntroImmediately?: boolean
  expiresAt?: Date
}

export interface UpdateConnectionParams {
  status?: WhatsAppConnectionStatus
  introMessageSentAt?: string
  introMessageId?: string
  lastMessageReceivedAt?: string
  totalConversations?: number
  connectedAt?: string
  disconnectedAt?: string
  disconnectionReason?: string
  expiresAt?: string
}

export interface WhatsAppConnectionWithAgent extends WhatsAppAgentConnection {
  agent: {
    id: string
    userId: string
    name: string
    mode: 'provider' | 'collector'
    greetingText?: string
    instructions: string
    fileKeys: string[]
    agentUrl: string
    allowAnonymous: boolean
    quickSuggestionsMode: 'off' | 'smart' | 'always'
    quickSuggestionsCount: number
    maxMessages?: number
    lastEmbeddingsSyncAt?: string
    createdAt: string
    updatedAt: string
  }
}

export interface ConnectionListResponse {
  connections: WhatsAppAgentConnection[]
  total: number
  page: number
  pageSize: number
}

export interface DisconnectConnectionParams {
  conversationAction: 'keep' | 'archive' | 'delete'
}
