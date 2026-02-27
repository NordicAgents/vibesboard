import { type AgentToolType } from '@/lib/types'

export const BUILTIN_AGENT_TOOLS = {
  'builtin:web_fetch': {
    id: 'builtin:web_fetch' as AgentToolType,
    name: 'Web Fetch',
    description: 'Fetches web page content from a given URL.'
  },
  'builtin:search': {
    id: 'builtin:search' as AgentToolType,
    name: 'Web Search',
    description: 'Searches the public web for recent information.'
  },
  'builtin:file_search': {
    id: 'builtin:file_search' as AgentToolType,
    name: 'File Search',
    description: "Searches the agent's uploaded files for matching snippets."
  }
} satisfies Record<
  AgentToolType,
  {
    id: AgentToolType
    name: string
    description: string
  }
>
