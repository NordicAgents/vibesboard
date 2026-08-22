/**
 * At-rest protection for `notificationConfig.webhook.secret`.
 *
 * That value is a live HMAC signing key (see webhook-utils.signPayload) but was
 * stored as plaintext inside the agents.notification_config JSONB column, so a
 * database leak handed over every tenant's webhook signing key.
 *
 * Only the `secret` field is sealed — the rest of the config (enabled flags,
 * URL, email address) stays queryable/readable as before. Sealing preserves the
 * string shape, so no schema change or migration is required: rows written
 * before this change are plaintext and are read back transparently by
 * `unsealMaybeSealed`.
 */
import { sealSecret, unsealMaybeSealed } from '@vibesboard/utils/secret-box'

interface WebhookLike {
  enabled: boolean
  url?: string | null
  secret?: string | null
}

interface NotificationConfigLike {
  webhook?: WebhookLike
}

function mapSecret<T extends NotificationConfigLike | null | undefined>(
  config: T,
  fn: (secret: string) => string | null
): T {
  if (!config?.webhook?.secret) return config
  return {
    ...config,
    webhook: { ...config.webhook, secret: fn(config.webhook.secret) }
  } as T
}

/** Encrypt the webhook secret before the config is written to the database. */
export function sealNotificationConfig<
  T extends NotificationConfigLike | null | undefined
>(config: T): T {
  return mapSecret(config, sealSecret)
}

/**
 * Decrypt the webhook secret after reading from the database. Idempotent: a
 * pre-migration plaintext secret is returned unchanged, so this is safe to
 * apply even where a value may already be plaintext.
 */
export function unsealNotificationConfig<
  T extends NotificationConfigLike | null | undefined
>(config: T): T {
  return mapSecret(config, unsealMaybeSealed)
}

/**
 * Drop the webhook secret entirely. Used for the immutable version snapshots:
 * keeping the secret out of history means rotating it actually erases it, and
 * — because a fresh seal produces different ciphertext every write — it also
 * stops re-sealing from looking like a config change and creating a spurious
 * version on every save.
 */
export function stripNotificationSecret<
  T extends NotificationConfigLike | null | undefined
>(config: T): T {
  return mapSecret(config, () => null)
}

/**
 * Preserve an existing secret when a response-redacted config is saved without
 * a `webhook.secret` field. An explicit `null` remains a deliberate clear.
 */
export function preserveNotificationSecret<
  T extends NotificationConfigLike | null | undefined
>(existing: T, updated: T): T {
  if (
    updated?.webhook &&
    updated.webhook.secret === undefined &&
    existing?.webhook?.secret
  ) {
    return {
      ...updated,
      webhook: { ...updated.webhook, secret: existing.webhook.secret }
    } as T
  }
  return updated
}
