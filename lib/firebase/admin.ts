import 'server-only'
import {
  initializeApp,
  getApps,
  cert,
  type App,
  type ServiceAccount
} from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

function getServiceAccount(): ServiceAccount {
  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  if (!key) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_KEY environment variable')
  }
  try {
    return JSON.parse(key) as ServiceAccount
  } catch {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON. Provide the full service account JSON string.'
    )
  }
}

function getAdminApp(): App {
  const existing = getApps()
  if (existing.length > 0) {
    return existing[0]
  }
  return initializeApp({
    credential: cert(getServiceAccount()),
    storageBucket: process.env.GCS_BUCKET_NAME
  })
}

const app = getAdminApp()

export const adminAuth = getAuth(app)
export const adminDb = getFirestore(app)
export const adminStorage = getStorage(app)
export { app as adminApp }
