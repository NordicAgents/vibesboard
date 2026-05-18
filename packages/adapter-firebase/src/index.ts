// @vibesboard/adapter-firebase
//
// Import via subpath, not via this barrel:
//   import { adminDb }       from '@vibesboard/adapter-firebase/admin'   // server
//   import { getClientAuth } from '@vibesboard/adapter-firebase/client'  // browser
//   import { bucket }        from '@vibesboard/adapter-firebase/storage' // GCS bucket handle
//
// File-operation helpers (signed URLs, download, delete) have moved to
// @vibesboard/adapter-s3. The ./storage subpath retains only the raw
// GCS bucket handle for code that needs GCS-native APIs.
//
// The admin and client SDKs can't share an import path — admin.ts is
// `server-only` and client.ts is `'use client'`. A default barrel would
// drag server-only code into client bundles. Use the subpaths instead.

export {}
