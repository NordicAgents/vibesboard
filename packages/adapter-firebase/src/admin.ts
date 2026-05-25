import 'server-only'
import {
  initializeApp,
  getApps,
  cert,
  type App,
  type ServiceAccount
} from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'

// Three modes:
//   1. Emulator — any FIREBASE_*_EMULATOR_HOST or FIRESTORE_EMULATOR_HOST env
//      var is set. Init without a service-account cert; the admin SDK reads
//      the emulator hosts itself at call time.
//   2. Runtime  — FIREBASE_SERVICE_ACCOUNT_KEY is set. Init with cert.
//   3. Build    — neither. Export no-op proxies so Next's page data collection
//      doesn't crash. Real calls at runtime would also no-op; that's intentional
//      since this mode only fires during `next build` without secrets injected.
const isEmulator =
  !!process.env.FIRESTORE_EMULATOR_HOST ||
  !!process.env.FIREBASE_AUTH_EMULATOR_HOST ||
  !!process.env.FIREBASE_STORAGE_EMULATOR_HOST
const isBuildTime = !isEmulator && !process.env.FIREBASE_SERVICE_ACCOUNT_KEY

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
  if (isEmulator) {
    // Emulators don't validate credentials, but the admin SDK still wants a
    // projectId. Read from the public NEXT_PUBLIC_FIREBASE_PROJECT_ID so dev
    // and emulator agree on the project namespace.
    return initializeApp({
      projectId:
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'demo-vibesboard',
      storageBucket: process.env.GCS_BUCKET_NAME
    })
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

if (isEmulator) {
  console.warn(
    '[firebase/admin] emulator hosts detected — admin SDK routed to emulators'
  )
} else if (isBuildTime) {
  console.warn(
    '[firebase/admin] FIREBASE_SERVICE_ACCOUNT_KEY not set — admin SDK disabled (build time)'
  )
}

// Recursive no-op proxy: any property access or function call returns
// another no-op proxy, so chains like adminAuth.getUser('x') silently
// resolve to undefined instead of crashing the build.
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

export const adminStorage = isBuildTime
  ? new Proxy({} as ReturnType<typeof getStorage>, buildTimeHandler)
  : getStorage(app())

export const adminApp = isBuildTime
  ? new Proxy({} as App, buildTimeHandler)
  : app()
