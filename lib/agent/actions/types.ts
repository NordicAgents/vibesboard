import type { VibeAgent, AgentAction } from '@/lib/types'
import type { RegisteredTool } from '@/lib/agent/tools/base'

export type { AgentAction }

// ─── Action type registry ──────────────────────────────────────────

export type ActionType = 'appointments' | 'booking' | 'data'

// ─── Module interface ──────────────────────────────────────────────

export interface ActionContext {
  agent: VibeAgent
  action: AgentAction
}

export interface ActionModule {
  type: ActionType
  buildTools(ctx: ActionContext): Promise<RegisteredTool[]>
}
