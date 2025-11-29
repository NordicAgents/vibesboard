import { type Message } from 'ai'
import { type SupabaseClient } from '@supabase/supabase-js'

import { type Database } from '@/lib/db_types'
import {
  type AgentToolType,
  type VibeAgent,
  type VibeAgentConversation,
  type VibeAgentTool
} from '@/lib/types'
import { nanoid, slugify } from '@/lib/utils'

type AgentRow = Database['public']['Tables']['vibe_agents']['Row']
type ConversationRow =
  Database['public']['Tables']['vibe_agent_conversations']['Row']

export const BUILTIN_AGENT_TOOLS: Record<
  Extract<AgentToolType, `builtin:${string}`>,
  {
    id: Extract<AgentToolType, `builtin:${string}`>
    name: string
    description: string
  }
> = {
  'builtin:web': {
    id: 'builtin:web',
    name: 'Web',
    description: 'Fetches web page content and performs web searches.'
  },
  'builtin:file_search': {
    id: 'builtin:file_search',
    name: 'File Search',
    description: 'Searches the agent\'s uploaded files for matching snippets.'
  }
}

const sanitizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === 'string')
}

const sanitizeMessages = (value: unknown): Message[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(
    (entry): entry is Message =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof entry.id === 'string' &&
      typeof entry.role === 'string' &&
      typeof entry.content === 'string'
  )
}

const sanitizeTools = (value: unknown): VibeAgentTool[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry): VibeAgentTool | null => {
      if (!entry || typeof entry !== 'object') {
        return null
      }

      const id = (entry as { id?: string }).id
      const name = (entry as { name?: string }).name
      const description = (entry as { description?: string }).description
      const config = (entry as { config?: Record<string, any> }).config
      const type = (entry as { type?: AgentToolType }).type

      if (type?.startsWith('builtin:')) {
        if (type in BUILTIN_AGENT_TOOLS) {
          return {
            ...BUILTIN_AGENT_TOOLS[type as keyof typeof BUILTIN_AGENT_TOOLS],
            id: type,
            type,
            name:
              name ??
              BUILTIN_AGENT_TOOLS[type as keyof typeof BUILTIN_AGENT_TOOLS]
                .name,
            description:
              description ??
              BUILTIN_AGENT_TOOLS[type as keyof typeof BUILTIN_AGENT_TOOLS]
                .description,
            config
          } satisfies VibeAgentTool
        }
        return null
      }

      return null
    })
    .filter((tool): tool is VibeAgentTool => Boolean(tool))
}

export const mapAgentRow = (row: AgentRow): VibeAgent => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  instructions: row.instructions,
  fileKeys: sanitizeStringArray(row.file_keys),
  agentUrl: row.agent_url,
  tools: sanitizeTools(row.tools),
  allowAnonymous: row.allow_anonymous,
  greetingText: (row as any).greeting_text ?? null,
  lastEmbeddingsSyncAt: (row as any).last_embeddings_sync_at ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

export const mapConversationRow = (
  row: ConversationRow
): VibeAgentConversation => ({
  id: row.id,
  agentId: row.agent_id,
  userId: row.user_id,
  externalId: row.external_id,
  summary: row.summary,
  messages: sanitizeMessages(row.messages),
  closedAt: (row as any).closed_at ?? null,
  summaryGeneratedAt: (row as any).summary_generated_at ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

export const createAgentSlug = (name: string) => {
  const base = slugify(name)
  return base.length ? base : nanoid().toLowerCase()
}

export const ensureUniqueSlug = async (
  slug: string,
  supabase: SupabaseClient<Database>
) => {
  let candidate = slug
  let attempt = 0

  while (attempt < 5) {
    const { data } = await supabase
      .from('vibe_agents')
      .select('id')
      .eq('agent_url', candidate)
      .maybeSingle()

    if (!data) {
      return candidate
    }

    candidate = `${slug}-${nanoid(3).toLowerCase()}`
    attempt += 1
  }

  return `${slug}-${nanoid(6).toLowerCase()}`
}
