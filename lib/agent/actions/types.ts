import type { VibeAgent } from '@/lib/types'
import type { RegisteredTool } from '@/lib/agent/tools/base'

// ─── Action type registry ──────────────────────────────────────────

export type ActionType = 'appointments' | 'booking' | 'data'

// ─── Agent action config (stored in Firestore agent.actions[]) ─────

export interface AgentAction {
  id: string
  type: ActionType
  enabled: boolean
  connectionId?: string | null
  config: Record<string, any> // narrowed per module via type guards
}

// ─── Module interface ──────────────────────────────────────────────

export interface ActionContext {
  agent: VibeAgent
  action: AgentAction
}

export interface ActionModule {
  type: ActionType
  buildTools(ctx: ActionContext): Promise<RegisteredTool[]>
}
