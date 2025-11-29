import { BUILTIN_AGENT_TOOLS } from '@/lib/agents/db'
import { type AgentToolType, type VibeAgentTool } from '@/lib/types'

const WEB_TOOL_TYPES: AgentToolType[] = ['builtin:web_fetch', 'builtin:search']
const FILE_TOOL_TYPE: AgentToolType = 'builtin:file_search'

export const deriveToolToggles = (tools: VibeAgentTool[]) => ({
  useWeb: tools.some(tool => WEB_TOOL_TYPES.includes(tool.type)),
  fileSearch: tools.some(tool => tool.type === FILE_TOOL_TYPE)
})

export const buildToolsPayload = (toggles: {
  useWeb: boolean
  fileSearch: boolean
}) => {
  const nextTools: AgentToolType[] = []

  if (toggles.useWeb) {
    nextTools.push('builtin:web_fetch', 'builtin:search')
  }

  if (toggles.fileSearch) {
    nextTools.push(FILE_TOOL_TYPE)
  }

  return nextTools.map(type => {
    const builtin =
      BUILTIN_AGENT_TOOLS[type as keyof typeof BUILTIN_AGENT_TOOLS]

    return {
      ...(builtin ?? { name: type }),
      id: type,
      type
    }
  })
}

export const getDisplayTools = (tools: VibeAgentTool[]) => {
  const display: { id: string; name: string }[] = []
  const toggles = deriveToolToggles(tools)

  if (toggles.useWeb) {
    display.push({ id: 'use-web', name: 'Use Web' })
  }

  if (toggles.fileSearch) {
    const builtin =
      BUILTIN_AGENT_TOOLS[FILE_TOOL_TYPE as keyof typeof BUILTIN_AGENT_TOOLS]

    display.push({
      id: FILE_TOOL_TYPE,
      name: builtin?.name ?? 'File Search'
    })
  }

  const groupedTypes = new Set<AgentToolType>([
    ...WEB_TOOL_TYPES,
    FILE_TOOL_TYPE
  ])

  tools.forEach(tool => {
    if (!groupedTypes.has(tool.type)) {
      display.push({ id: tool.id, name: tool.name })
    }
  })

  return display
}
