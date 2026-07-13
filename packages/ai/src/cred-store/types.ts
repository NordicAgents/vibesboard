/**
 * Pluggable credential store for LLM provider API keys.
 *
 * The DB row stores an opaque "token" returned by seal(). The CredStore
 * implementation decides what that token is:
 *   - EncryptedDbCredStore  → AES-encrypted ciphertext (swap to cloud later)
 *   - AwsSecretsCredStore   → Secrets Manager secret ID / ARN
 *   - VaultCredStore        → Vault path
 *
 * To migrate storage backends, implement this interface and swap the export
 * in cred-store/index.ts — no changes needed in tenant-llm-config.ts.
 */
export interface CredStore {
  /** Encrypt / persist a plaintext secret. Returns an opaque token to store in the DB row. */
  seal(plaintext: string): Promise<string>
  /** Recover plaintext from a previously sealed token. */
  unseal(token: string): Promise<string>
  /** Clean up any external storage when a config is deleted. No-op for inline DB storage. */
  revoke(token: string): Promise<void>
}
