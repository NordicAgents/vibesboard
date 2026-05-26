import type { DataConnectionDocument } from '@vibesboard/contracts'
import type { DataProvider } from './types.ts'
import { CustomWebhookProvider } from './custom-webhook.ts'
import { AirtableProvider } from './airtable.ts'
import { GoogleSheetsProvider } from './google-sheets.ts'

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
        headers: connection.webhookHeaders
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
