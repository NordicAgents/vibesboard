import type { ActionModule, ActionContext, AgentAction } from './types'
import type { RegisteredTool } from '@/lib/agent/tools/base'
import type { VibeAgent } from '@/lib/types'
import { AppointmentsModule } from './appointments'
import { BookingModule } from './booking'
import { DataModule } from './data'

const ACTION_REGISTRY: Record<string, ActionModule> = {
  appointments: AppointmentsModule,
  booking: BookingModule,
  data: DataModule,
}

/**
 * Inject action tools into a toolkit by iterating through agent.actions
 * and delegating to the registry. Replaces all if/else blocks in context-builder.
 */
export async function injectActionTools(
  agent: VibeAgent,
  toolkit: { functions: any[]; executors: Record<string, any> }
): Promise<void> {
  const actions: AgentAction[] = agent.actions ?? []

  for (const action of actions) {
    if (!action.enabled) continue

    const module = ACTION_REGISTRY[action.type]
    if (!module) continue

    try {
      const ctx: ActionContext = { agent, action }
      const tools: RegisteredTool[] = await module.buildTools(ctx)

      for (const tool of tools) {
        toolkit.functions.push(tool.function)
        toolkit.executors[tool.function.name] = tool.execute
      }
    } catch (err) {
      console.error(`Failed to inject ${action.type} tools:`, err)
    }
  }
}
