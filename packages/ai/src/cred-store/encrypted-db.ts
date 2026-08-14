import { sealSecret, unsealSecret } from '@vibesboard/utils/secret-box'
import type { CredStore } from './types.ts'

/**
 * Stores secrets as authenticated (AES-256-GCM) ciphertext inline in the DB
 * column. The token IS the ciphertext — no external service required. Delegates
 * to the shared secret-box, which provides versioned keys, key rotation
 * (ENCRYPTION_KEY current + ENCRYPTION_KEYS_OLD for decrypt), and transparent
 * decryption of any legacy CryptoJS ciphertext already in the database.
 *
 * Swap this for AwsSecretsCredStore (or similar) when moving to a cloud
 * secrets backend; the interface contract is identical.
 */
export class EncryptedDbCredStore implements CredStore {
  async seal(plaintext: string): Promise<string> {
    return sealSecret(plaintext)
  }

  async unseal(token: string): Promise<string> {
    return unsealSecret(token)
  }

  async revoke(_token: string): Promise<void> {
    // No-op: the token lives in the DB row; row deletion removes it.
  }
}
