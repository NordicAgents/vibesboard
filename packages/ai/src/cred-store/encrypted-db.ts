import CryptoJS from 'crypto-js'
import type { CredStore } from './types.ts'

function getKey(): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('[cred-store] ENCRYPTION_KEY is not set')
  return key
}

/**
 * Stores secrets as AES-encrypted ciphertext inline in the DB column.
 * The token IS the ciphertext — no external service required.
 *
 * Swap this for AwsSecretsCredStore (or similar) when moving to a cloud
 * secrets backend; the interface contract is identical.
 */
export class EncryptedDbCredStore implements CredStore {
  async seal(plaintext: string): Promise<string> {
    return CryptoJS.AES.encrypt(plaintext, getKey()).toString()
  }

  async unseal(token: string): Promise<string> {
    const bytes = CryptoJS.AES.decrypt(token, getKey())
    return bytes.toString(CryptoJS.enc.Utf8)
  }

  async revoke(_token: string): Promise<void> {
    // No-op: the token lives in the DB row; row deletion removes it.
  }
}
