import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  sealNotificationConfig,
  unsealNotificationConfig,
  stripNotificationSecret,
  preserveNotificationSecret
} from '../notification-secret.ts'
import {
  toAgentConfigSnapshot,
  applySnapshotToAgentUpdate,
  snapshotsEqual
} from '../versioning.ts'

let savedKey: string | undefined

beforeEach(() => {
  savedKey = process.env.ENCRYPTION_KEY
  process.env.ENCRYPTION_KEY = 'notif-secret-test-key-000000000000'
})

afterEach(() => {
  if (savedKey === undefined) delete process.env.ENCRYPTION_KEY
  else process.env.ENCRYPTION_KEY = savedKey
})

const config = (secret: string | null) => ({
  enabled: true,
  events: ['completed'],
  inApp: { enabled: true },
  email: { enabled: false, address: null },
  webhook: { enabled: true, url: 'https://hook.example.com', secret }
})

describe('notification webhook secret at rest', () => {
  it('seals only the secret, leaving the rest of the config intact', () => {
    const sealed = sealNotificationConfig(config('hmac-signing-key'))
    expect(sealed.webhook.secret).not.toBe('hmac-signing-key')
    expect(sealed.webhook.secret!.startsWith('v1:')).toBe(true)
    // Everything else is untouched and still queryable.
    expect(sealed.webhook.url).toBe('https://hook.example.com')
    expect(sealed.enabled).toBe(true)
    expect(sealed.email).toEqual({ enabled: false, address: null })
  })

  it('round-trips through seal -> unseal', () => {
    const sealed = sealNotificationConfig(config('hmac-signing-key'))
    expect(unsealNotificationConfig(sealed).webhook.secret).toBe(
      'hmac-signing-key'
    )
  })

  it('unseal is idempotent on a pre-migration plaintext secret', () => {
    // Rows written before this change hold the raw secret.
    const plaintext = config('legacy-plaintext-secret')
    expect(unsealNotificationConfig(plaintext).webhook.secret).toBe(
      'legacy-plaintext-secret'
    )
  })

  it('passes through configs with no secret unchanged', () => {
    expect(sealNotificationConfig(null)).toBeNull()
    expect(sealNotificationConfig(undefined)).toBeUndefined()
    const noSecret = config(null)
    expect(sealNotificationConfig(noSecret)).toBe(noSecret)
  })
})

describe('version snapshots exclude the webhook secret', () => {
  const row = (notificationConfig: unknown) =>
    ({
      name: 'a',
      instructions: '',
      mode: 'provider',
      allowAnonymous: false,
      quickSuggestionsMode: 'off',
      quickSuggestionsCount: 4,
      googleReviewEnabled: false,
      notificationConfig
    }) as never

  it('strips the secret out of the stored snapshot', () => {
    const snap = toAgentConfigSnapshot(row(config('super-secret')))
    expect(snap.notificationConfig!.webhook.secret).toBeNull()
    // ...but keeps the rest of the notification config versioned.
    expect(snap.notificationConfig!.webhook.url).toBe(
      'https://hook.example.com'
    )
  })

  it('does not report a config change when only the ciphertext differs', () => {
    // Re-sealing produces fresh ciphertext every write; without stripping, that
    // would look like an edit and create an empty version on every save.
    const a = toAgentConfigSnapshot(
      row(sealNotificationConfig(config('same-secret')))
    )
    const b = toAgentConfigSnapshot(
      row(sealNotificationConfig(config('same-secret')))
    )
    expect(snapshotsEqual(a, b)).toBe(true)
  })

  it('restore carries the live secret forward instead of wiping it', () => {
    const snap = toAgentConfigSnapshot(row(config('super-secret')))
    const update = applySnapshotToAgentUpdate(snap, {
      notificationConfig: config('live-secret')
    } as never)
    expect(update.notificationConfig!.webhook.secret).toBe('live-secret')
    expect(update.notificationConfig!.webhook.url).toBe(
      'https://hook.example.com'
    )
  })

  it('restore with no live secret leaves it null', () => {
    const snap = toAgentConfigSnapshot(row(config('super-secret')))
    const update = applySnapshotToAgentUpdate(snap, {
      notificationConfig: config(null)
    } as never)
    expect(update.notificationConfig!.webhook.secret).toBeNull()
  })
})

describe('stripNotificationSecret', () => {
  it('nulls the secret without touching other fields', () => {
    const stripped = stripNotificationSecret(config('x'))
    expect(stripped.webhook.secret).toBeNull()
    expect(stripped.webhook.enabled).toBe(true)
  })
})

describe('preserveNotificationSecret', () => {
  it('keeps the existing secret when a redacted response is saved', () => {
    const updated = preserveNotificationSecret(config('live-secret'), {
      ...config(null),
      webhook: { enabled: true, url: 'https://new.example.test' }
    } as never)

    expect(updated.webhook.secret).toBe('live-secret')
  })

  it('allows an explicit null to clear the secret', () => {
    expect(
      preserveNotificationSecret(config('live-secret'), config(null)).webhook
        .secret
    ).toBeNull()
  })
})
