import 'server-only'

import { type NotificationEvent } from '@vibesboard/contracts'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import type { VibeAgent } from '@vibesboard/contracts'
import type { CompletionReason } from '@vibesboard/ai/completion'
import {
  createInAppNotification,
  getUserEmail
} from './notifications-db.ts'
import { assertSafeCallbackUrl, signPayload } from './webhook-utils.ts'

// ─── Public API ──────────────────────────────────────────────────────

interface NotificationPayload {
  agent: VibeAgent
  conversationId: string
  event: NotificationEvent
  summary?: string | null
  messageCount?: number
}

/**
 * Map a CompletionReason to a NotificationEvent.
 * Returns null for unknown/unhandled reasons.
 */
export function mapCompletionToEvent(
  reason: CompletionReason
): NotificationEvent | null {
  switch (reason) {
    case 'collection_complete':
    case 'info_complete':
    case 'max_responses':
    case 'max_messages':
      return 'completed'
    case 'handoff_to_human':
      return 'handoff'
    case 'handoff_to_agent':
      return 'agent_handoff'
    default:
      return null
  }
}

/**
 * Fire-and-forget notification dispatch.
 * Checks feature flags + agent config, then dispatches to enabled channels.
 * Never throws — all errors are logged and swallowed.
 */
export function dispatchAgentNotification(payload: NotificationPayload): void {
  _dispatchAsync(payload).catch(err => {
    console.error('[notifications] Dispatch failed:', err)
  })
}

// ─── Internal dispatch ───────────────────────────────────────────────

async function _dispatchAsync(payload: NotificationPayload): Promise<void> {
  const { agent, event } = payload
  const tenantId = agent.tenantId
  if (!tenantId) return

  // 1. Master feature flag gate
  const masterEnabled = await isFeatureEnabled(tenantId, 'AGENT_NOTIFICATIONS')
  if (!masterEnabled) return

  // 2. Per-agent config gate
  const config = agent.notificationConfig
  if (!config?.enabled) return
  if (!config.events.includes(event)) return

  // 3. Check sub-flags and agent channel config, dispatch enabled channels
  const promises: Promise<void>[] = []

  if (config.inApp?.enabled) {
    const flagEnabled = await isFeatureEnabled(
      tenantId,
      'AGENT_NOTIFICATIONS_INAPP'
    )
    if (flagEnabled) {
      promises.push(sendInAppNotification(payload))
    }
  }

  if (config.email?.enabled) {
    const flagEnabled = await isFeatureEnabled(
      tenantId,
      'AGENT_NOTIFICATIONS_EMAIL'
    )
    if (flagEnabled) {
      promises.push(sendEmailNotification(payload, config.email.address))
    }
  }

  if (config.webhook?.enabled && config.webhook.url) {
    const flagEnabled = await isFeatureEnabled(
      tenantId,
      'AGENT_NOTIFICATIONS_WEBHOOK'
    )
    if (flagEnabled) {
      promises.push(
        sendWebhookNotification(
          payload,
          config.webhook.url,
          config.webhook.secret
        )
      )
    }
  }

  await Promise.allSettled(promises)
}

// ─── Senders ─────────────────────────────────────────────────────────

async function sendInAppNotification(
  payload: NotificationPayload
): Promise<void> {
  const { agent, conversationId, event, summary } = payload
  await createInAppNotification({
    tenantId: agent.tenantId!,
    agentId: agent.id,
    conversationId: conversationId || null,
    event,
    summary: summary ?? null
  })
}

async function sendEmailNotification(
  payload: NotificationPayload,
  configuredAddress?: string | null
): Promise<void> {
  const { agent, conversationId, event, summary } = payload

  let toAddress = configuredAddress
  if (!toAddress) {
    toAddress = await getUserEmail(agent.userId)
  }
  if (!toAddress) return

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn(
      '[notifications] RESEND_API_KEY not configured, skipping email'
    )
    return
  }

  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)

  const eventLabel =
    event === 'handoff'
      ? 'needs human handoff'
      : event === 'agent_handoff'
        ? 'transferred to another agent'
        : 'completed'
  const subject = `[${agent.name}] Conversation ${eventLabel}`

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const conversationUrl = `${appUrl}/agents/${agent.id}/conversations/${conversationId}`

  const lines = [
    `Agent: ${agent.name}`,
    `Event: ${eventLabel}`,
    summary ? `\nSummary:\n${summary}` : null,
    `\nView conversation:\n${conversationUrl}`
  ]
    .filter(Boolean)
    .join('\n')

  await resend.emails.send({
    from:
      process.env.NOTIFICATION_EMAIL_FROM ||
      'VibeAgent <notifications@vibeagent.com>',
    to: toAddress,
    subject,
    text: lines
  })
}

async function sendWebhookNotification(
  payload: NotificationPayload,
  url: string,
  secret?: string | null
): Promise<void> {
  assertSafeCallbackUrl(url)

  const body = JSON.stringify({
    event: payload.event,
    agentId: payload.agent.id,
    agentName: payload.agent.name,
    conversationId: payload.conversationId,
    summary: payload.summary ?? null,
    messageCount: payload.messageCount ?? null,
    timestamp: new Date().toISOString()
  })

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  if (secret) {
    headers['X-Notification-Signature'] = signPayload(body, secret)
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(10_000)
  })

  if (!res.ok) {
    console.warn(`[notifications] Webhook delivery failed: ${res.status}`)
  }
}
