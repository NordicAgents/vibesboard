// @vibesboard/adapter-firebase
//
// Import via subpath, not via this barrel:
//   import { adminDb }       from '@vibesboard/adapter-firebase/admin'   // server
//   import { getClientAuth } from '@vibesboard/adapter-firebase/client'  // browser
//   import { downloadFile }  from '@vibesboard/adapter-firebase/storage'
//
// The admin and client SDKs can't share an import path — admin.ts is
// `server-only` and client.ts is `'use client'`. A default barrel would
// drag server-only code into client bundles. Use the subpaths instead.

export {}
