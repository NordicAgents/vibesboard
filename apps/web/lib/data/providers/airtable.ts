import type { AppendRowResult, DataProvider, UpdateRowResult } from './types'

const AIRTABLE_API = 'https://api.airtable.com/v0'

interface AirtableConfig {
  apiToken: string
  baseId: string
  tableId: string
}

export class AirtableProvider implements DataProvider {
  private config: AirtableConfig

  constructor(config: AirtableConfig) {
    this.config = config
  }

  async appendRow(data: Record<string, any>): Promise<AppendRowResult> {
    const url = `${AIRTABLE_API}/${this.config.baseId}/${this.config.tableId}`
    const response = await this.fetch(url, {
      method: 'POST',
      body: JSON.stringify({ fields: data })
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(
        `Airtable error ${response.status}: ${(body as any)?.error?.message ?? 'Unknown error'}`
      )
    }

    const result = (await response.json()) as { id: string }
    return { success: true, externalRef: result.id }
  }

  async updateRow(
    keyField: string,
    keyValue: string,
    data: Record<string, any>
  ): Promise<UpdateRowResult> {
    // Find the record by key field
    const formula = encodeURIComponent(`{${keyField}}="${keyValue}"`)
    const searchUrl = `${AIRTABLE_API}/${this.config.baseId}/${this.config.tableId}?filterByFormula=${formula}&maxRecords=1`
    const searchResponse = await this.fetch(searchUrl, { method: 'GET' })

    if (!searchResponse.ok) {
      const body = await searchResponse.json().catch(() => ({}))
      throw new Error(
        `Airtable search error ${searchResponse.status}: ${(body as any)?.error?.message ?? 'Unknown error'}`
      )
    }

    const searchResult = (await searchResponse.json()) as {
      records: Array<{ id: string }>
    }

    if (!searchResult.records.length) {
      return { success: false, matched: false }
    }

    const recordId = searchResult.records[0].id
    const updateUrl = `${AIRTABLE_API}/${this.config.baseId}/${this.config.tableId}/${recordId}`
    const updateResponse = await this.fetch(updateUrl, {
      method: 'PATCH',
      body: JSON.stringify({ fields: data })
    })

    if (!updateResponse.ok) {
      const body = await updateResponse.json().catch(() => ({}))
      throw new Error(
        `Airtable update error ${updateResponse.status}: ${(body as any)?.error?.message ?? 'Unknown error'}`
      )
    }

    return { success: true, matched: true, externalRef: recordId }
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const url = `${AIRTABLE_API}/${this.config.baseId}/${this.config.tableId}?maxRecords=1`
      const response = await this.fetch(url, { method: 'GET' })
      if (response.ok) {
        return { ok: true }
      }
      const body = await response.json().catch(() => ({}))
      return {
        ok: false,
        error: `${response.status}: ${(body as any)?.error?.message ?? 'Access denied'}`
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Connection failed'
      }
    }
  }

  private async fetch(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    try {
      return await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
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
