#!/usr/bin/env npx tsx
/**
 * Seed a calendar connection in Firestore for E2E testing.
 * Uses service account JWT to get an access token, then stores it encrypted.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createSign } from 'crypto'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import CryptoJS from 'crypto-js'

const TENANT_ID = 'deSAtwrXcbo4KYrVjShr'
const USER_ID = 'XrYFyYAxiSdkMaqE2hFlK5Vs18p1'

function loadEnvKey(key: string): string | undefined {
  try {
    const envPath = resolve(__dirname, '..', '.env.local')
    const content = readFileSync(envPath, 'utf8')
    const regex = new RegExp(`^${key}=(.+)`, 'm')
    const match = content.match(regex)
    if (match) {
      let val = match[1].trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      return val
    }
  } catch {}
  return undefined
}

const saKeyRaw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || loadEnvKey('FIREBASE_SERVICE_ACCOUNT_KEY')
if (!saKeyRaw) {
  console.error('ERROR: No Firebase credentials')
  process.exit(1)
}
const saKey = JSON.parse(saKeyRaw)

if (!getApps().length) {
  initializeApp({ credential: cert(saKey) })
}

const db = getFirestore()
const encryptionKey = process.env.ENCRYPTION_KEY || loadEnvKey('ENCRYPTION_KEY')
if (!encryptionKey) {
  console.error('ERROR: ENCRYPTION_KEY is not set')
  process.exit(1)
}

function encrypt(value: string): string {
  return CryptoJS.AES.encrypt(value, encryptionKey!).toString()
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input
  return buf.toString('base64url')
}

async function getServiceAccountToken(scopes: string[]): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({
    iss: saKey.client_email,
    scope: scopes.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }))

  const signInput = `${header}.${payload}`
  const signer = createSign('RSA-SHA256')
  signer.update(signInput)
  const signature = signer.sign(saKey.private_key, 'base64url')

  const jwt = `${signInput}.${signature}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token exchange failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  return data.access_token
}

async function main() {
  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events'
  ]

  console.log('Getting service account access token...')
  const accessToken = await getServiceAccountToken(scopes)
  console.log('Got access token, length:', accessToken.length)

  const calendarId = saKey.client_email
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString()

  const connectionData = {
    tenantId: TENANT_ID,
    provider: 'google',
    name: 'Elam Resort Calendar',
    calendarId,
    accessToken: encrypt(accessToken),
    refreshToken: encrypt('service-account-no-refresh'),
    tokenExpiresAt: expiresAt,
    email: saKey.client_email,
    scopes,
    status: 'active',
    connectedBy: USER_ID,
    connectedAt: now,
    createdAt: now,
    updatedAt: now
  }

  const ref = await db
    .collection('tenants')
    .doc(TENANT_ID)
    .collection('calendar_connections')
    .add(connectionData)

  console.log(`\nCreated calendar connection: ${ref.id}`)
  console.log(`Calendar ID: ${calendarId}`)
  console.log('Status: active')

  // Now update the agent's bookingConfig with a resource pointing to this connection
  // Find the agent
  const agentsSnap = await db
    .collection('tenants')
    .doc(TENANT_ID)
    .collection('agents')
    .where('name', '==', 'Elam Resort Booking Manager')
    .limit(1)
    .get()

  if (agentsSnap.empty) {
    console.log('\nAgent not found — update bookingConfig manually.')
    return
  }

  const agentDoc = agentsSnap.docs[0]
  console.log(`\nFound agent: ${agentDoc.id}`)

  const bookingConfig = {
    enabled: true,
    mode: 'direct',
    eventTitleTemplate: '{guest_name} ({guest_count} guests)',
    eventTimeMode: 'all-day',
    overlapProtection: true,
    resources: [
      {
        id: 'room-glass-cabin',
        name: 'Glass Cabin',
        calendarConnectionId: ref.id,
        calendarId,
        calendarName: 'Elam Resort Calendar',
        timezone: 'Asia/Kolkata'
      },
      {
        id: 'room-tree-house',
        name: 'Tree House',
        calendarConnectionId: ref.id,
        calendarId, // Using same calendar for testing; in production each room has its own
        calendarName: 'Elam Resort Calendar',
        timezone: 'Asia/Kolkata'
      }
    ]
  }

  await agentDoc.ref.update({ bookingConfig })
  console.log('Updated agent bookingConfig with 2 rooms: Glass Cabin, Tree House')
  console.log('Mode: direct (owner-facing)')
  console.log('\nDone! Reload the agent page to test.')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
