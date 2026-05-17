import { type BuiltinToolType } from '@/lib/types'

export const BUILTIN_AGENT_TOOLS = {
  'builtin:web_fetch': {
    id: 'builtin:web_fetch' as BuiltinToolType,
    name: 'Web Fetch',
    description: 'Fetches web page content from a given URL.'
  },
  'builtin:file_search': {
    id: 'builtin:file_search' as BuiltinToolType,
    name: 'File Search',
    description: "Searches the agent's uploaded files for matching snippets."
  },
  'builtin:bash': {
    id: 'builtin:bash' as BuiltinToolType,
    name: 'Bash',
    description:
      'Run shell commands against uploaded files in a sandboxed virtual filesystem.'
  }
} satisfies Record<
  BuiltinToolType,
  {
    id: BuiltinToolType
    name: string
    description: string
  }
>
