import 'server-only'
import { auth as firebaseAuth } from '@/lib/firebase/auth'

// Re-export the Firebase auth helper as the app-wide auth() function.
// This keeps all existing `import { auth } from '@/auth'` calls working.
export const auth = firebaseAuth
