import type { DataConnectionDocument } from '@vibesboard/contracts'
import { unsealMaybeSealed } from '@vibesboard/utils/secret-box'
import type { DataProvider } from './types.ts'
import { CustomWebhookProvider } from './custom-webhook.ts'
import { AirtableProvider } from './airtable.ts'
import { GoogleSheetsProvider } from './google-sheets.ts'

/**
 * Decrypt stored webhook header values. Idempotent: values written before the
 * at-rest encryption change are plaintext and pass through unchanged.
 */
function decryptHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!headers) return headers
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k, unsealMaybeSealed(v)])
  )
}

/**
 * Create a data provider instance from a connection document.
 * @param connection The data connection config
 * @param decryptedToken Decrypted access token (OAuth) or API token
 */
export function createDataProvider(
  connection: DataConnectionDocument,
  decryptedToken: string
): DataProvider {
  switch (connection.provider) {
    case 'google_sheets':
      return new GoogleSheetsProvider({
        accessToken: decryptedToken,
        spreadsheetId: connection.spreadsheetId!,
        sheetName: connection.sheetName ?? 'Sheet1'
      })

    case 'airtable':
      return new AirtableProvider({
        apiToken: decryptedToken,
        baseId: connection.baseId!,
        tableId: connection.tableId!
      })

    case 'custom_webhook':
      return new CustomWebhookProvider({
        webhookUrl: connection.webhookUrl!,
        method: connection.webhookMethod ?? 'POST',
        // Header VALUES are encrypted at rest (they commonly carry an
        // Authorization credential) and decrypted only here, at the point of
        // use — matching how access/API tokens are handled. Names stay in
        // cleartext so connections remain debuggable.
        headers: decryptHeaders(connection.webhookHeaders)
      })

    default:
      throw new Error(`Unsupported data provider: ${connection.provider}`)
  }
}

export type { DataProvider } from './types.ts'

// Re-export the per-provider implementations and the createDataProvider
// helpers so consumers that imported '@/lib/data/providers/<file>' keep
// working through the providers-barrel shim.
export { CustomWebhookProvider } from './custom-webhook.ts'
export { AirtableProvider } from './airtable.ts'
export { GoogleSheetsProvider } from './google-sheets.ts'
