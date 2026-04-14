import { type VibeAgent } from '@/lib/types'
import { createRetriever } from '@/lib/retrieval'
import { buildToolKit, type ToolExecutionContext, type ToolKit } from './tools'
import { injectActionTools } from './actions/registry'

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

  // Inject action module tools (appointments, booking, data, etc.)
  await injectActionTools(agent, toolkit)

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
