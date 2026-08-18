import { type VibeAgent } from '@vibesboard/contracts'
import { isCrossTenantFileKey } from '@vibesboard/adapter-s3'
import { createRetriever } from '@vibesboard/retrieval'
import { deriveToolToggles } from '@vibesboard/agents/tooling'
import { buildToolKit, type ToolExecutionContext, type ToolKit } from './tools/index.ts'
import { injectActionTools } from './actions/registry.ts'

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

  // Defence in depth against a poisoned fileKeys array: never retrieve (and
  // thus never read into the model context) a key that addresses another
  // tenant's storage. This path is reachable anonymously via public chat, so
  // it is the last line before another tenant's document could be exfiltrated.
  const tenantId = agent.tenantId ?? ''
  const safeFileKeys = (agent.fileKeys ?? []).filter(
    key => !isCrossTenantFileKey(key, tenantId)
  )

  // The Knowledge tab's File search switch. Passed to the retriever so the
  // RAG strategy honors it too — it builds its own file_search tool, which
  // wins the name-collision merge below, so without this the switch had no
  // effect under RAG.
  const { fileSearch: fileSearchEnabled } = deriveToolToggles(agent.tools ?? [])

  const retriever = createRetriever(strategy, {
    agentId: agent.id,
    tenantId,
    fileKeys: safeFileKeys,
    sourceUrls: agent.sourceUrls,
    fileSearchEnabled
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
