import type {
  AppendRowResult,
  DataProvider,
  UpdateRowResult
} from './types.ts'

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'

interface GoogleSheetsConfig {
  accessToken: string
  spreadsheetId: string
  sheetName: string
}

export class GoogleSheetsProvider implements DataProvider {
  private config: GoogleSheetsConfig

  constructor(config: GoogleSheetsConfig) {
    this.config = config
  }

  async appendRow(data: Record<string, any>): Promise<AppendRowResult> {
    // Get or create header row
    const headers = await this.ensureHeaders(Object.keys(data))

    // Build row in header order
    const row = headers.map(h => data[h] ?? '')

    const range = encodeURIComponent(`${this.config.sheetName}!A:A`)
    const url = `${SHEETS_API}/${this.config.spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`

    const response = await this.fetch(url, {
      method: 'POST',
      body: JSON.stringify({ values: [row] })
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(
        `Google Sheets append error ${response.status}: ${(body as any)?.error?.message ?? 'Unknown error'}`
      )
    }

    const result = (await response.json()) as {
      updates?: { updatedRange?: string }
    }
    return {
      success: true,
      externalRef: result.updates?.updatedRange
    }
  }

  async updateRow(
    keyField: string,
    keyValue: string,
    data: Record<string, any>
  ): Promise<UpdateRowResult> {
    // Read header row to find column indices
    const headers = await this.getHeaders()
    const keyColIndex = headers.indexOf(keyField)
    if (keyColIndex === -1) {
      throw new Error(`Key field "${keyField}" not found in sheet headers`)
    }

    // Read key column to find matching row
    const keyColLetter = columnToLetter(keyColIndex)
    const range = encodeURIComponent(
      `${this.config.sheetName}!${keyColLetter}:${keyColLetter}`
    )
    const colUrl = `${SHEETS_API}/${this.config.spreadsheetId}/values/${range}`
    const colResponse = await this.fetch(colUrl, { method: 'GET' })

    if (!colResponse.ok) {
      throw new Error(`Failed to read key column: HTTP ${colResponse.status}`)
    }

    const colResult = (await colResponse.json()) as {
      values?: string[][]
    }
    const values = colResult.values ?? []

    // Find matching row (skip header at index 0)
    let matchRowIndex = -1
    for (let i = 1; i < values.length; i++) {
      if (values[i]?.[0] === keyValue) {
        matchRowIndex = i + 1 // 1-based Sheets row number
        break
      }
    }

    if (matchRowIndex === -1) {
      return { success: false, matched: false }
    }

    // Build update row in header order
    const updateRow = headers.map(
      h => (h in data ? data[h] : '') // only update provided fields, leave rest empty to skip
    )

    // We need to update only the fields provided, so we'll update cell by cell
    // to avoid clearing existing data. Use batchUpdate for efficiency.
    const updateRequests: Array<{
      range: string
      values: string[][]
    }> = []

    for (const [field, value] of Object.entries(data)) {
      const colIdx = headers.indexOf(field)
      if (colIdx === -1) continue
      const col = columnToLetter(colIdx)
      updateRequests.push({
        range: `${this.config.sheetName}!${col}${matchRowIndex}`,
        values: [[String(value ?? '')]]
      })
    }

    if (updateRequests.length === 0) {
      return {
        success: true,
        matched: true,
        externalRef: `row ${matchRowIndex}`
      }
    }

    const batchUrl = `${SHEETS_API}/${this.config.spreadsheetId}/values:batchUpdate`
    const batchResponse = await this.fetch(batchUrl, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: updateRequests
      })
    })

    if (!batchResponse.ok) {
      const body = await batchResponse.json().catch(() => ({}))
      throw new Error(
        `Google Sheets update error ${batchResponse.status}: ${(body as any)?.error?.message ?? 'Unknown error'}`
      )
    }

    return {
      success: true,
      matched: true,
      externalRef: `row ${matchRowIndex}`
    }
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const url = `${SHEETS_API}/${this.config.spreadsheetId}?fields=properties.title`
      const response = await this.fetch(url, { method: 'GET' })
      if (response.ok) {
        return { ok: true }
      }
      return { ok: false, error: `HTTP ${response.status}` }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Connection failed'
      }
    }
  }

  private async getHeaders(): Promise<string[]> {
    const range = encodeURIComponent(`${this.config.sheetName}!1:1`)
    const url = `${SHEETS_API}/${this.config.spreadsheetId}/values/${range}`
    const response = await this.fetch(url, { method: 'GET' })

    if (!response.ok) {
      return []
    }

    const result = (await response.json()) as { values?: string[][] }
    return result.values?.[0] ?? []
  }

  private async ensureHeaders(fields: string[]): Promise<string[]> {
    const existing = await this.getHeaders()

    // If sheet has no headers, write them
    if (existing.length === 0) {
      const range = encodeURIComponent(`${this.config.sheetName}!A1`)
      const url = `${SHEETS_API}/${this.config.spreadsheetId}/values/${range}?valueInputOption=RAW`
      await this.fetch(url, {
        method: 'PUT',
        body: JSON.stringify({ values: [fields] })
      })
      return fields
    }

    // Add any missing headers
    const missing = fields.filter(f => !existing.includes(f))
    if (missing.length > 0) {
      const newHeaders = [...existing, ...missing]
      const range = encodeURIComponent(`${this.config.sheetName}!A1`)
      const url = `${SHEETS_API}/${this.config.spreadsheetId}/values/${range}?valueInputOption=RAW`
      await this.fetch(url, {
        method: 'PUT',
        body: JSON.stringify({ values: [newHeaders] })
      })
      return newHeaders
    }

    return existing
  }

  private async fetch(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    try {
      return await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
          ...(init.headers as Record<string, string> | undefined)
        },
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeout)
    }
  }
}

/** Convert 0-based column index to letter (0=A, 25=Z, 26=AA, etc.) */
function columnToLetter(index: number): string {
  let letter = ''
  let n = index
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter
    n = Math.floor(n / 26) - 1
  }
  return letter
}
