#!/usr/bin/env -S node --experimental-strip-types
/**
 * Register the Google RISC (Cross-Account Protection) event receiver.
 *
 * Prerequisites:
 *   1. Enable the RISC API in your GCP project:
 *      https://console.cloud.google.com/apis/library/risc.googleapis.com
 *   2. Grant "RISC Configuration Admin" role to your service account:
 *      gcloud projects add-iam-policy-binding YOUR_PROJECT \
 *        --member="serviceAccount:YOUR_SA_EMAIL" \
 *        --role="roles/riscconfigs.admin"
 *   3. Set GOOGLE_OAUTH_CLIENT_ID in your .env.local (the Web client ID from
 *      Firebase Console > Authentication > Sign-in method > Google)
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT_KEY='{ ... }' \
 *   NEXT_PUBLIC_APP_URL=https://your-domain.com \
 *   node --experimental-strip-types scripts/register-risc.ts
 */
import crypto from 'crypto'

// ── Helpers ─────────────────────────────────────────────────────────────────

function env(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
  return v
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input
  return buf.toString('base64url')
}

// Create a self-signed JWT bearer token for the RISC API
function createBearerToken(sa: {
  client_email: string
  private_key: string
}): string {
  const now = Math.floor(Date.now() / 1000)

  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://risc.googleapis.com/',
    iat: now,
    exp: now + 3600
  }

  const segments = [
    base64url(JSON.stringify(header)),
    base64url(JSON.stringify(payload))
  ]
  const signingInput = segments.join('.')

  const sign = crypto.createSign('RSA-SHA256')
  sign.update(signingInput)
  const signature = sign.sign(sa.private_key)

  return `${signingInput}.${base64url(signature)}`
}

// ── Event types to subscribe to ─────────────────────────────────────────────

const RISC_EVENT_PREFIX =
  'https://schemas.openid.net/secevent/risc/event-type/'

const EVENTS_REQUESTED = [
  `${RISC_EVENT_PREFIX}sessions-revoked`,
  `${RISC_EVENT_PREFIX}tokens-revoked`,
  `${RISC_EVENT_PREFIX}token-revoked`,
  `${RISC_EVENT_PREFIX}account-disabled`,
  `${RISC_EVENT_PREFIX}account-enabled`,
  `${RISC_EVENT_PREFIX}account-credential-change-required`,
  `${RISC_EVENT_PREFIX}verification`
]

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const saJson = env('FIREBASE_SERVICE_ACCOUNT_KEY')
  const appUrl = env('NEXT_PUBLIC_APP_URL')

  const sa = JSON.parse(saJson) as {
    client_email: string
    private_key: string
    project_id: string
  }

  const receiverUrl = `${appUrl.replace(/\/$/, '')}/api/webhooks/google-risc`
  const token = createBearerToken(sa)

  console.log(`Project:      ${sa.project_id}`)
  console.log(`Service acct: ${sa.client_email}`)
  console.log(`Receiver URL: ${receiverUrl}`)
  console.log()

  // ── Register the stream ──────────────────────────────────────────────────

  console.log('Registering RISC event stream...')

  const updateRes = await fetch(
    'https://risc.googleapis.com/v1beta/stream:update',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        delivery: {
          delivery_method:
            'https://schemas.openid.net/secevent/risc/delivery-method/push',
          url: receiverUrl
        },
        events_requested: EVENTS_REQUESTED
      })
    }
  )

  if (!updateRes.ok) {
    const text = await updateRes.text()
    console.error(`Failed to register stream (${updateRes.status}):`, text)
    process.exit(1)
  }

  console.log('Stream registered successfully!')
  console.log()

  // ── Send a verification event ────────────────────────────────────────────

  console.log('Sending verification event...')

  const verifyRes = await fetch(
    'https://risc.googleapis.com/v1beta/stream:verify',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        state: `risc-verify-${Date.now()}`
      })
    }
  )

  if (!verifyRes.ok) {
    const text = await verifyRes.text()
    console.warn(`Verification request failed (${verifyRes.status}):`, text)
    console.warn(
      'This is non-critical — your endpoint is registered but check your server logs for the verification event.'
    )
  } else {
    console.log(
      'Verification event sent! Check your server logs for the incoming event.'
    )
  }

  console.log()
  console.log('Done. Cross-Account Protection is now configured.')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
