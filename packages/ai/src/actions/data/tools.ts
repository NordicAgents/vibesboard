import { adminDb } from '@vibesboard/adapter-firebase/admin'
import {
  Collections,
  type DataActionLogDocument,
  type DataConnectionDocument
} from '@vibesboard/contracts'
import { createDataProvider } from '@vibesboard/data/providers'
import { getDataConnection, getValidDataAccessToken } from '@vibesboard/data/connections'
import type { RegisteredTool } from '@vibesboard/ai/tools/base'
import type { VibeAgent } from '@vibesboard/contracts'
import type { ActionContext } from '../types.ts'
import type { DataConfig } from './types.ts'

interface DataToolContext {
  agent: VibeAgent
  connection: DataConnectionDocument
  config: DataConfig
}

function mapDataToColumns(
  data: Record<string, any>,
  config: DataConfig
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
        ([key]) => key.toLowerCase() === mapping.targetColumn.toLowerCase()
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
    execute: async args => {
      const rawData = args.data as Record<string, any> | undefined
      if (
        !rawData ||
        typeof rawData !== 'object' ||
        Object.keys(rawData).length === 0
      ) {
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
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error'
        await logDataAction(
          ctx,
          'append_row',
          'failed',
          rawData,
          undefined,
          errorMsg
        )
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
    execute: async args => {
      const keyValue = String(args.key_value ?? '').trim()
      const rawData = args.data as Record<string, any> | undefined

      if (!keyValue) {
        return `Please provide the value to search for in the "${keyField}" field.`
      }
      if (
        !rawData ||
        typeof rawData !== 'object' ||
        Object.keys(rawData).length === 0
      ) {
        return 'Please provide data to update as key-value pairs.'
      }

      try {
        const accessToken = await getValidDataAccessToken(ctx.connection)
        const provider = createDataProvider(ctx.connection, accessToken)
        const mappedData = mapDataToColumns(rawData, ctx.config)

        const result = await provider.updateRow(keyField, keyValue, mappedData)

        if (!result.matched) {
          await logDataAction(
            ctx,
            'update_row',
            'failed',
            rawData,
            undefined,
            `No record found with ${keyField}="${keyValue}"`
          )
          return `No record found where "${keyField}" = "${keyValue}". Please check the value and try again.`
        }

        await logDataAction(
          ctx,
          'update_row',
          'success',
          mappedData,
          result.externalRef
        )

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
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error'
        await logDataAction(
          ctx,
          'update_row',
          'failed',
          rawData,
          undefined,
          errorMsg
        )
        return `Error updating record: ${errorMsg}`
      }
    }
  }
}

function buildQueryRecordsTool(ctx: DataToolContext): RegisteredTool {
  const keyField = ctx.config.updateKeyField ?? 'id'

  return {
    function: {
      name: 'query_records',
      description: `Query records from the data store by searching for a matching value. Searches where "${keyField}" matches the provided key_value.`,
      parameters: {
        type: 'object',
        properties: {
          key_value: {
            type: 'string',
            description: `The value to search for in the "${keyField}" field.`
          },
          limit: {
            type: 'number',
            description: 'Maximum number of records to return (default: 10).'
          }
        },
        required: ['key_value']
      }
    },
    execute: async (args) => {
      const keyValue = String(args.key_value ?? '').trim()
      const limit = typeof args.limit === 'number' ? args.limit : 10

      if (!keyValue) {
        return `Please provide the value to search for in the "${keyField}" field.`
      }

      try {
        const accessToken = await getValidDataAccessToken(ctx.connection)
        const provider = createDataProvider(ctx.connection, accessToken)

        if (!provider.queryRows) {
          return 'Query is not supported by this data provider.'
        }

        const result = await provider.queryRows(keyField, keyValue, limit)

        if (result.rows.length === 0) {
          return `No records found where "${keyField}" = "${keyValue}".`
        }

        const lines = [
          `Found ${result.totalMatched} record(s) (showing ${result.rows.length}):`,
          ...result.rows.map((row, i) => {
            const fields = Object.entries(row)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ')
            return `${i + 1}. ${fields}`
          })
        ]
        return lines.join('\n')
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        return `Error querying records: ${errorMsg}`
      }
    }
  }
}

function buildDeleteRecordTool(ctx: DataToolContext): RegisteredTool {
  const keyField = ctx.config.updateKeyField ?? 'id'

  return {
    function: {
      name: 'delete_record',
      description: `Delete a record from the data store. Always confirm with the user before deleting. Finds and removes the record where "${keyField}" matches the provided key_value.`,
      parameters: {
        type: 'object',
        properties: {
          key_value: {
            type: 'string',
            description: `The value to search for in the "${keyField}" field to find the record to delete.`
          }
        },
        required: ['key_value']
      }
    },
    execute: async (args) => {
      const keyValue = String(args.key_value ?? '').trim()

      if (!keyValue) {
        return `Please provide the value to search for in the "${keyField}" field.`
      }

      try {
        const accessToken = await getValidDataAccessToken(ctx.connection)
        const provider = createDataProvider(ctx.connection, accessToken)

        if (!provider.deleteRow) {
          return 'Delete is not supported by this data provider.'
        }

        const result = await provider.deleteRow(keyField, keyValue)

        if (!result.matched) {
          await logDataAction(
            ctx,
            'delete_row' as DataActionLogDocument['action'],
            'failed',
            { [keyField]: keyValue },
            undefined,
            `No record found with ${keyField}="${keyValue}"`
          )
          return `No record found where "${keyField}" = "${keyValue}". Nothing was deleted.`
        }

        await logDataAction(
          ctx,
          'delete_row' as DataActionLogDocument['action'],
          'success',
          { [keyField]: keyValue }
        )

        return `Record deleted successfully where "${keyField}" = "${keyValue}".`
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        await logDataAction(
          ctx,
          'delete_row' as DataActionLogDocument['action'],
          'failed',
          { [keyField]: keyValue },
          undefined,
          errorMsg
        )
        return `Error deleting record: ${errorMsg}`
      }
    }
  }
}

export async function buildDataTools(ctx: ActionContext): Promise<RegisteredTool[]> {
  const config = ctx.action.config as DataConfig
  const connectionId = ctx.action.connectionId
  if (!connectionId || !ctx.agent.tenantId) return []

  const connection = await getDataConnection(ctx.agent.tenantId, connectionId)
  if (!connection || connection.status !== 'active') return []

  const toolCtx: DataToolContext = { agent: ctx.agent, connection, config }
  const tools: RegisteredTool[] = [buildSubmitDataTool(toolCtx)]

  if (config.updateKeyField) {
    tools.push(buildUpdateRecordTool(toolCtx))
  }
  if (config.allowQuery) {
    tools.push(buildQueryRecordsTool(toolCtx))
  }
  if (config.allowDelete) {
    tools.push(buildDeleteRecordTool(toolCtx))
  }

  return tools
}
