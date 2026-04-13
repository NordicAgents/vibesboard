import { type VibeAgent } from '@/lib/types'
import { createRetriever } from '@/lib/retrieval'
import { buildToolKit, type ToolExecutionContext, type ToolKit } from './tools'
import { isFeatureEnabled } from '@/lib/features'
import {
  getCalendarConnection,
  getValidAccessToken
} from '@/lib/scheduling/connections'
import { buildSchedulingTools } from './tools/scheduling'
import { getDataConnection } from '@/lib/data/connections'
import { buildDataTools } from './tools/data-actions'
import { buildCalendarAvailabilityTools } from './tools/calendar-availability'
import { buildSimpleBookingTools } from './tools/simple-booking'
import { buildDirectBookingTools } from './tools/direct-booking'

export interface ContextBuildResult {
  contextText: string
  toolkit: ToolKit
  sources: string[]
  hasFileOverflow: boolean
  dispose: () => Promise<void>
}

/**
 * Assemble agent context by delegating file retrieval to the configured strategy,
 * then loading source URLs and building the pruned toolkit.
 */
export async function buildAgentContext(
  agent: VibeAgent,
  toolContext?: ToolExecutionContext
): Promise<ContextBuildResult> {
  const strategy = agent.retrievalStrategy ?? 'direct'

  const retriever = createRetriever(strategy, {
    agentId: agent.id,
    tenantId: agent.tenantId ?? '',
    fileKeys: agent.fileKeys,
    sourceUrls: agent.sourceUrls
  })

  await retriever.prepare()
  const result = await retriever.build()

  // Build toolkit from agent tools config
  const fullToolkit = buildToolKit(agent, {
    fileContext: toolContext?.fileContext ?? null
  })

  // Merge retriever-provided tools into the toolkit.
  // Retriever tools take precedence — deduplicate by name.
  const retrieverToolNames = new Set(result.tools.map(t => t.function.name))
  const functions = [
    ...fullToolkit.functions.filter(fn => !retrieverToolNames.has(fn.name)),
    ...result.tools.map(t => t.function)
  ]
  const executors = {
    ...Object.fromEntries(
      Object.entries(fullToolkit.executors).filter(
        ([name]) => !retrieverToolNames.has(name)
      )
    ),
    ...Object.fromEntries(result.tools.map(t => [t.function.name, t.execute]))
  }

  // For direct strategy: remove file_search if all files fit in context
  let toolkit: ToolKit = { functions, executors }
  if (
    strategy === 'direct' &&
    !result.hasOverflow &&
    agent.fileKeys.length > 0
  ) {
    toolkit = {
      functions: functions.filter(fn => fn.name !== 'file_search'),
      executors: Object.fromEntries(
        Object.entries(executors).filter(([name]) => name !== 'file_search')
      )
    }
  }

  // Inject scheduling tools if the agent has scheduling enabled
  if (
    agent.schedulingConfig?.enabled &&
    agent.schedulingConfig.calendarConnectionId &&
    agent.tenantId
  ) {
    try {
      const scheduleEnabled = await isFeatureEnabled(
        agent.tenantId,
        'AGENT_ACTIONS_SCHEDULE'
      )
      if (scheduleEnabled) {
        const connection = await getCalendarConnection(
          agent.tenantId,
          agent.schedulingConfig.calendarConnectionId
        )
        if (connection && connection.status === 'active') {
          const schedulingTools = buildSchedulingTools(agent, connection)
          for (const tool of schedulingTools) {
            toolkit.functions.push(tool.function)
            toolkit.executors[tool.function.name] = tool.execute
          }
        }
      }
    } catch (err) {
      // Scheduling injection failure should not block the chat
      console.error('Failed to inject scheduling tools:', err)
    }
  }

  // Inject data action tools if the agent has data actions enabled
  if (
    agent.dataConfig?.enabled &&
    agent.dataConfig.dataConnectionId &&
    agent.tenantId
  ) {
    try {
      const dataEnabled = await isFeatureEnabled(
        agent.tenantId,
        'AGENT_ACTIONS_DATA'
      )
      if (dataEnabled) {
        const dataConnection = await getDataConnection(
          agent.tenantId,
          agent.dataConfig.dataConnectionId
        )
        if (dataConnection && dataConnection.status === 'active') {
          const dataTools = buildDataTools(agent, dataConnection)
          for (const tool of dataTools) {
            toolkit.functions.push(tool.function)
            toolkit.executors[tool.function.name] = tool.execute
          }
        }
      }
    } catch (err) {
      // Data action injection failure should not block the chat
      console.error('Failed to inject data action tools:', err)
    }
  }

  // Inject booking/availability tools — simple-booking takes precedence, falls back to
  // legacy calendar-availability. Never register both (same tool name conflict).
  if (agent.bookingConfig?.enabled && agent.tenantId) {
    try {
      const bookingEnabled = await isFeatureEnabled(
        agent.tenantId,
        'AGENT_ACTIONS_BOOKING'
      )
      if (bookingEnabled) {
        // Direct mode: owner CRUD tools. Enquiry mode: guest-facing tools.
        const bookingTools =
          agent.bookingConfig.mode === 'direct'
            ? buildDirectBookingTools(agent)
            : buildSimpleBookingTools(agent)
        for (const tool of bookingTools) {
          toolkit.functions.push(tool.function)
          toolkit.executors[tool.function.name] = tool.execute
        }
      }
    } catch (err) {
      console.error('Failed to inject booking tools:', err)
    }
  } else if (
    agent.calendarAvailabilityConfig?.enabled &&
    agent.calendarAvailabilityConfig.calendarConnectionId &&
    agent.tenantId
  ) {
    try {
      const scheduleEnabled = await isFeatureEnabled(
        agent.tenantId,
        'AGENT_ACTIONS_SCHEDULE'
      )
      if (scheduleEnabled) {
        const connection = await getCalendarConnection(
          agent.tenantId,
          agent.calendarAvailabilityConfig.calendarConnectionId
        )
        if (connection && connection.status === 'active') {
          const availabilityTools = buildCalendarAvailabilityTools(
            agent,
            connection
          )
          for (const tool of availabilityTools) {
            toolkit.functions.push(tool.function)
            toolkit.executors[tool.function.name] = tool.execute
          }
        }
      }
    } catch (err) {
      console.error('Failed to inject calendar availability tools:', err)
    }
  }

  return {
    contextText: result.contextText,
    toolkit,
    sources: result.sources,
    hasFileOverflow: result.hasOverflow,
    // Caller must invoke dispose() after the stream completes so that
    // retriever-owned resources (e.g. BashRetriever's in-memory sandbox)
    // remain live for the full duration of tool execution.
    dispose: () => retriever.dispose()
  }
}
