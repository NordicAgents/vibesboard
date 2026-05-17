'use client'

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
}

// When NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST is set (dev only), wire the
// client Auth SDK to the local emulator. Mirrors the admin-side detection
// in ./admin.ts.
const authEmulatorHost = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST

let app: FirebaseApp | undefined
let auth: Auth | undefined

export function getClientApp(): FirebaseApp {
  if (!app) {
    const existing = getApps()
    app = existing.length > 0 ? existing[0] : initializeApp(firebaseConfig)
  }
  return app
}

export function getClientAuth(): Auth {
  if (!auth) {
    auth = getAuth(getClientApp())
    if (authEmulatorHost) {
      connectAuthEmulator(auth, `http://${authEmulatorHost}`, {
        disableWarnings: true
      })
    }
  }
  return auth
}
