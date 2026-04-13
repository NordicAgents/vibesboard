#!/usr/bin/env npx tsx
/**
 * List all calendar connections across all tenants.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

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

if (!getApps().length) {
  const saKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || loadEnvKey('FIREBASE_SERVICE_ACCOUNT_KEY')
  if (saKey) {
    initializeApp({ credential: cert(JSON.parse(saKey)) })
  } else {
    console.error('ERROR: No Firebase credentials')
    process.exit(1)
  }
}

const db = getFirestore()

async function main() {
  // List all tenants
  const tenantsSnap = await db.collection('tenants').get()
  console.log(`Found ${tenantsSnap.size} tenants\n`)

  for (const tenant of tenantsSnap.docs) {
    const connectionsSnap = await db
      .collection('tenants')
      .doc(tenant.id)
      .collection('calendar_connections')
      .get()

    if (connectionsSnap.empty) continue

    console.log(`Tenant: ${tenant.data().name} (${tenant.id})`)
    for (const conn of connectionsSnap.docs) {
      const d = conn.data()
      console.log(`  Connection: ${conn.id}`)
      console.log(`    Provider: ${d.provider}`)
      console.log(`    Name: ${d.name}`)
      console.log(`    Email: ${d.email}`)
      console.log(`    Status: ${d.status}`)
      console.log(`    CalendarId: ${d.calendarId}`)
      console.log(`    TokenExpires: ${d.tokenExpiresAt}`)
      console.log()
    }
  }
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
