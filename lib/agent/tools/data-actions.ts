import { adminDb } from '@/lib/firebase/admin'
import {
  Collections,
  type AgentDataConfig,
  type DataActionLogDocument,
  type DataConnectionDocument
} from '@/lib/firestore-types'
import { createDataProvider } from '@/lib/data/providers'
import { getValidDataAccessToken } from '@/lib/data/connections'
import type { RegisteredTool } from './base'
import type { VibeAgent } from '@/lib/types'

interface DataToolContext {
  agent: VibeAgent
  connection: DataConnectionDocument
  config: AgentDataConfig
}

function mapDataToColumns(
  data: Record<string, any>,
  config: AgentDataConfig
): Record<string, any> {
  if (config.fieldMappings.length === 0) {
    // No explicit mappings — pass data through as-is (keys = column names)
    return data
  }

  const mapped: Record<string, any> = {}
  for (const mapping of config.fieldMappings) {
    // Try to match by collectionFieldId first, then by label (key)
    const value =
      data[mapping.collectionFieldId] ??
      data[mapping.targetColumn] ??
      // Also try matching the field label directly from the data keys
      Object.entries(data).find(
        ([key]) =>
          key.toLowerCase() === mapping.targetColumn.toLowerCase()
      )?.[1]

    if (value !== undefined) {
      mapped[mapping.targetColumn] = value
    }
  }

  // Include any unmapped fields as-is
  for (const [key, value] of Object.entries(data)) {
    const isMapped = config.fieldMappings.some(
      m =>
        m.collectionFieldId === key ||
        m.targetColumn.toLowerCase() === key.toLowerCase()
    )
    if (!isMapped) {
      mapped[key] = value
    }
  }

  return mapped
}

async function logDataAction(
  ctx: DataToolContext,
  action: DataActionLogDocument['action'],
  status: 'success' | 'failed',
  rowData: Record<string, any>,
  externalRef?: string,
  error?: string
): Promise<void> {
  try {
    const logsPath = Collections.dataLogs(ctx.agent.tenantId!, ctx.agent.id)
    const docRef = adminDb.collection(logsPath).doc()
    const log: DataActionLogDocument = {
      id: docRef.id,
      agentId: ctx.agent.id,
      tenantId: ctx.agent.tenantId!,
      conversationId: '', // populated by caller if available
      connectionId: ctx.connection.id,
      provider: ctx.connection.provider,
      action,
      status,
      rowData,
      externalRef,
      error,
      createdAt: new Date().toISOString()
    }
    await docRef.set(log)
  } catch {
    // Logging failure should not block the tool response
    console.error('Failed to log data action')
  }
}

function buildSubmitDataTool(ctx: DataToolContext): RegisteredTool {
  return {
    function: {
      name: 'submit_data',
      description:
        'Submit collected data to the configured data store (Google Sheets, Airtable, or webhook). Call this after collecting all required information from the user.',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            description:
              'Key-value pairs of field names/labels to their values. Example: {"Name": "John", "Email": "john@example.com"}'
          }
        },
        required: ['data']
      }
    },
    execute: async (args) => {
      const rawData = args.data as Record<string, any> | undefined
      if (!rawData || typeof rawData !== 'object' || Object.keys(rawData).length === 0) {
        return 'Please provide data as key-value pairs. Example: {"Name": "John", "Email": "john@example.com"}'
      }

      try {
        const accessToken = await getValidDataAccessToken(ctx.connection)
        const provider = createDataProvider(ctx.connection, accessToken)
        const mappedData = mapDataToColumns(rawData, ctx.config)

        const result = await provider.appendRow(mappedData)

        await logDataAction(
          ctx,
          ctx.connection.provider === 'custom_webhook'
            ? 'webhook_submit'
            : 'append_row',
          'success',
          mappedData,
          result.externalRef
        )

        const providerLabel =
          ctx.connection.provider === 'google_sheets'
            ? 'Google Sheets'
            : ctx.connection.provider === 'airtable'
              ? 'Airtable'
              : 'webhook'

        const lines = [
          `Data submitted successfully to ${providerLabel}!`,
          `Fields: ${Object.keys(mappedData).join(', ')}`
        ]
        if (result.externalRef) {
          lines.push(`Reference: ${result.externalRef}`)
        }
        return lines.join('\n')
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        await logDataAction(ctx, 'append_row', 'failed', rawData, undefined, errorMsg)
        return `Error submitting data: ${errorMsg}`
      }
    }
  }
}

function buildUpdateRecordTool(ctx: DataToolContext): RegisteredTool {
  const keyField = ctx.config.updateKeyField!

  return {
    function: {
      name: 'update_record',
      description: `Update an existing record in the data store. Searches for a record where "${keyField}" matches the provided key_value, then updates it with the given data.`,
      parameters: {
        type: 'object',
        properties: {
          key_value: {
            type: 'string',
            description: `The value to search for in the "${keyField}" field to find the record to update.`
          },
          data: {
            type: 'object',
            description:
              'Key-value pairs of fields to update. Example: {"Status": "Completed", "Notes": "Done"}'
          }
        },
        required: ['key_value', 'data']
      }
    },
    execute: async (args) => {
      const keyValue = String(args.key_value ?? '').trim()
      const rawData = args.data as Record<string, any> | undefined

      if (!keyValue) {
        return `Please provide the value to search for in the "${keyField}" field.`
      }
      if (!rawData || typeof rawData !== 'object' || Object.keys(rawData).length === 0) {
        return 'Please provide data to update as key-value pairs.'
      }

      try {
        const accessToken = await getValidDataAccessToken(ctx.connection)
        const provider = createDataProvider(ctx.connection, accessToken)
        const mappedData = mapDataToColumns(rawData, ctx.config)

        const result = await provider.updateRow(keyField, keyValue, mappedData)

        if (!result.matched) {
          await logDataAction(ctx, 'update_row', 'failed', rawData, undefined, `No record found with ${keyField}="${keyValue}"`)
          return `No record found where "${keyField}" = "${keyValue}". Please check the value and try again.`
        }

        await logDataAction(ctx, 'update_row', 'success', mappedData, result.externalRef)

        const lines = [
          `Record updated successfully!`,
          `Matched: ${keyField} = "${keyValue}"`,
          `Updated fields: ${Object.keys(mappedData).join(', ')}`
        ]
        if (result.externalRef) {
          lines.push(`Reference: ${result.externalRef}`)
        }
        return lines.join('\n')
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        await logDataAction(ctx, 'update_row', 'failed', rawData, undefined, errorMsg)
        return `Error updating record: ${errorMsg}`
      }
    }
  }
}

/**
 * Build all data action tools for an agent with an active data connection.
 */
export function buildDataTools(
  agent: VibeAgent,
  connection: DataConnectionDocument
): RegisteredTool[] {
  const config = agent.dataConfig
  if (!config?.enabled) return []

  const ctx: DataToolContext = { agent, connection, config }
  const tools: RegisteredTool[] = [buildSubmitDataTool(ctx)]

  // Only add update_record if a key field is configured
  if (config.updateKeyField) {
    tools.push(buildUpdateRecordTool(ctx))
  }

  return tools
}
