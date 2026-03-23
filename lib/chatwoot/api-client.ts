import 'server-only'

/**
 * Chatwoot REST API client
 *
 * All calls authenticate via the `api_access_token` header
 * using a User Access Token generated in Chatwoot profile settings.
 */

// ─── Helpers ─────────────────────────────────────────────────────────

function sanitizeUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

async function chatwootFetch<T>(
  chatwootUrl: string,
  path: string,
  apiToken: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${sanitizeUrl(chatwootUrl)}${path}`

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      api_access_token: apiToken,
      ...options.headers
    }
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `Chatwoot API error ${res.status}: ${text || res.statusText}`
    )
  }

  return res.json() as Promise<T>
}

// ─── Types ───────────────────────────────────────────────────────────

export interface ChatwootProfile {
  id: number
  account_id: number
  name: string
  email: string
}

export interface ChatwootInbox {
  id: number
  name: string
  channel_type: string
  greeting_enabled?: boolean
  greeting_message?: string
}

export interface ChatwootWebhook {
  id: number
  url: string
  subscriptions: string[]
  account_id: number
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Validate Chatwoot credentials by fetching the user profile.
 * Returns the account ID and display name on success.
 */
export async function validateChatwootCredentials(
  chatwootUrl: string,
  apiToken: string
): Promise<
  | { valid: true; accountId: number; name: string }
  | { valid: false; error: string }
> {
  try {
    const profile = await chatwootFetch<ChatwootProfile>(
      chatwootUrl,
      '/auth/sign_in',
      apiToken,
      { method: 'POST', body: JSON.stringify({ email: '', password: '' }) }
    ).catch(async () => {
      // Fallback: try the profile endpoint
      const data = await chatwootFetch<ChatwootProfile>(
        chatwootUrl,
        '/api/v1/profile',
        apiToken
      )
      return data
    })

    if (!profile?.account_id) {
      return { valid: false, error: 'Could not determine Chatwoot account ID' }
    }

    return {
      valid: true,
      accountId: profile.account_id,
      name: profile.name || profile.email || 'Chatwoot User'
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to validate credentials'
    return { valid: false, error: message }
  }
}

/**
 * List inboxes for a Chatwoot account.
 */
export async function listChatwootInboxes(
  chatwootUrl: string,
  apiToken: string,
  accountId: number
): Promise<ChatwootInbox[]> {
  const data = await chatwootFetch<{ payload: ChatwootInbox[] }>(
    chatwootUrl,
    `/api/v1/accounts/${accountId}/inboxes`,
    apiToken
  )

  return (data.payload ?? []).map(inbox => ({
    id: inbox.id,
    name: inbox.name,
    channel_type: inbox.channel_type,
    greeting_enabled: inbox.greeting_enabled,
    greeting_message: inbox.greeting_message
  }))
}

/**
 * Create a webhook in Chatwoot that subscribes to message_created events.
 */
export async function createChatwootWebhook(
  chatwootUrl: string,
  apiToken: string,
  accountId: number,
  webhookUrl: string
): Promise<ChatwootWebhook> {
  const data = await chatwootFetch<{ payload: ChatwootWebhook }>(
    chatwootUrl,
    `/api/v1/accounts/${accountId}/integrations/webhooks`,
    apiToken,
    {
      method: 'POST',
      body: JSON.stringify({
        url: webhookUrl,
        subscriptions: ['message_created']
      })
    }
  )

  return data.payload
}

/**
 * Delete a webhook from Chatwoot. Best-effort — does not throw on failure.
 */
export async function deleteChatwootWebhook(
  chatwootUrl: string,
  apiToken: string,
  accountId: number,
  webhookId: number
): Promise<void> {
  try {
    await chatwootFetch<void>(
      chatwootUrl,
      `/api/v1/accounts/${accountId}/integrations/webhooks/${webhookId}`,
      apiToken,
      { method: 'DELETE' }
    )
  } catch (err) {
    console.error('[chatwoot] Failed to delete webhook:', err)
  }
}

/**
 * Send a message to a Chatwoot conversation.
 */
export async function sendChatwootMessage(
  chatwootUrl: string,
  apiToken: string,
  accountId: number,
  conversationId: number,
  content: string
): Promise<{ id: number }> {
  const data = await chatwootFetch<{ id: number }>(
    chatwootUrl,
    `/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`,
    apiToken,
    {
      method: 'POST',
      body: JSON.stringify({
        content,
        message_type: 'outgoing'
      })
    }
  )

  return data
}
