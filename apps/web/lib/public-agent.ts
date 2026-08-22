/** Final response-boundary guard for agent access-gate secrets. */
export function toPublicAgentResponse<T extends object>(
  agent: T
): Omit<T, 'accessPassword' | 'accessPasswordHash'> {
  const safeAgent = { ...agent } as Record<string, unknown>
  delete safeAgent.accessPassword
  delete safeAgent.accessPasswordHash

  // Notification webhook secrets are live HMAC signing keys. They must never
  // cross an API response boundary, including internal tenant member lists.
  const notificationConfig = safeAgent.notificationConfig
  if (notificationConfig && typeof notificationConfig === 'object') {
    const safeConfig = { ...(notificationConfig as Record<string, unknown>) }
    const webhook = safeConfig.webhook
    if (webhook && typeof webhook === 'object') {
      const safeWebhook = { ...(webhook as Record<string, unknown>) }
      delete safeWebhook.secret
      safeConfig.webhook = safeWebhook
    }
    safeAgent.notificationConfig = safeConfig
  }

  return safeAgent as Omit<T, 'accessPassword' | 'accessPasswordHash'>
}
