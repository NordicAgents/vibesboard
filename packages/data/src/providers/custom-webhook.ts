import type {
  AppendRowResult,
  DataProvider,
  UpdateRowResult
} from './types.ts'

interface CustomWebhookConfig {
  webhookUrl: string
  method: 'POST' | 'PUT'
  headers?: Record<string, string>
}

export class CustomWebhookProvider implements DataProvider {
  private config: CustomWebhookConfig

  constructor(config: CustomWebhookConfig) {
    this.config = config
  }

  async appendRow(data: Record<string, any>): Promise<AppendRowResult> {
    const response = await this.send({
      action: 'append',
      data,
      timestamp: new Date().toISOString()
    })

    if (!response.ok) {
      throw new Error(
        `Webhook returned ${response.status}: ${await response.text().catch(() => 'unknown error')}`
      )
    }

    return { success: true }
  }

  async updateRow(
    keyField: string,
    keyValue: string,
    data: Record<string, any>
  ): Promise<UpdateRowResult> {
    const response = await this.send({
      action: 'update',
      keyField,
      keyValue,
      data,
      timestamp: new Date().toISOString()
    })

    if (!response.ok) {
      throw new Error(
        `Webhook returned ${response.status}: ${await response.text().catch(() => 'unknown error')}`
      )
    }

    // Attempt to parse the response for match status; default to true since
    // webhooks may not return structured data about whether a record was found.
    try {
      const body = await response.json()
      if (typeof body?.matched === 'boolean') {
        return { success: true, matched: body.matched }
      }
    } catch {
      // Response is not JSON or has no body — assume matched
    }
    return { success: true, matched: true }
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await this.send({ action: 'test' })
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

  private async send(body: Record<string, any>): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    try {
      return await fetch(this.config.webhookUrl, {
        method: this.config.method,
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeout)
    }
  }
}
