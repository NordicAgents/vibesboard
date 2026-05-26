import type { ChatwootConnection } from '@vibesboard/adapter-postgres/schema'
import type { ChatwootConnectionDocument } from '@vibesboard/contracts'

const toIso = (d: Date | null): string | undefined =>
  d ? d.toISOString() : undefined

export const rowToChatwootConnection = (
  r: ChatwootConnection
): ChatwootConnectionDocument => ({
  id: r.id,
  agentId: r.agentId,
  tenantId: r.tenantId,
  userId: r.userId ?? '',
  chatwootUrl: r.chatwootUrl,
  chatwootAccountId: r.chatwootAccountId,
  chatwootInboxId: r.chatwootInboxId,
  chatwootInboxName: r.chatwootInboxName,
  encryptedApiToken: r.apiTokenEncrypted,
  chatwootWebhookId: r.chatwootWebhookId ?? null,
  agentBotId: r.agentBotId ?? null,
  agentBotName: r.agentBotName ?? null,
  encryptedBotToken: r.botTokenEncrypted ?? null,
  useAgentBot: r.useAgentBot,
  webhookSecretHash: r.webhookSecretHash,
  status: r.status,
  lastMessageReceivedAt: toIso(r.lastMessageReceivedAt),
  totalConversations: r.totalConversations,
  disconnectedAt: toIso(r.disconnectedAt),
  disconnectionReason: r.disconnectionReason ?? undefined,
  errorMessage: r.errorMessage ?? undefined,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})
