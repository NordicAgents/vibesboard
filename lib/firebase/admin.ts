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

// During Next.js build (page data collection), FIREBASE_SERVICE_ACCOUNT_KEY
// is not available because it's a runtime-only secret injected by Cloud Run.
// We guard all initialization so the build succeeds, and throw at runtime
// only when a request actually needs the admin SDK.
const isBuildTime = !process.env.FIREBASE_SERVICE_ACCOUNT_KEY

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

let _app: App | undefined
function app(): App {
  if (!_app) {
    _app = getAdminApp()
  }
  return _app
}

// At build time, export no-op proxies that won't crash during page data
// collection. At runtime (when the env var exists), export real instances.
if (isBuildTime) {
  console.warn(
    '[firebase/admin] FIREBASE_SERVICE_ACCOUNT_KEY not set — admin SDK disabled (build time)'
  )
}

// Recursive no-op proxy: any property access or function call returns
// another no-op proxy, so chains like adminDb.collection('x').doc('y').get()
// silently resolve to undefined instead of crashing the build.
function noop(): any {
  return new Proxy(function () {}, {
    get: (_target, prop) => {
      if (prop === 'then') return undefined // prevent Promise-like behavior
      return noop()
    },
    apply: () => noop()
  })
}
const buildTimeHandler: ProxyHandler<any> = {
  get: (_target, prop) => {
    if (prop === 'then') return undefined
    return noop()
  }
}

export const adminAuth = isBuildTime
  ? new Proxy({} as ReturnType<typeof getAuth>, buildTimeHandler)
  : getAuth(app())

export const adminDb = isBuildTime
  ? new Proxy({} as ReturnType<typeof getFirestore>, buildTimeHandler)
  : getFirestore(app())

export const adminStorage = isBuildTime
  ? new Proxy({} as ReturnType<typeof getStorage>, buildTimeHandler)
  : getStorage(app())

export const adminApp = isBuildTime
  ? new Proxy({} as App, buildTimeHandler)
  : app()
