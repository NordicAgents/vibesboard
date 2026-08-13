export type { CredStore } from './types.ts'
export { EncryptedDbCredStore } from './encrypted-db.ts'

import { EncryptedDbCredStore } from './encrypted-db.ts'
import type { CredStore } from './types.ts'

/** Default store: AES-encrypted in the DB column. Replace to switch backends. */
export const credStore: CredStore = new EncryptedDbCredStore()
