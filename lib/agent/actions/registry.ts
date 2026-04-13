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
 * Build an AgentAction[] from the legacy config fields for backward compatibility.
 * Only used during the migration transition period.
 */
function buildLegacyActions(agent: VibeAgent): AgentAction[] {
  const actions: AgentAction[] = []

  if (agent.schedulingConfig?.enabled && agent.schedulingConfig.calendarConnectionId) {
    actions.push({
      id: 'legacy-appointments',
      type: 'appointments',
      enabled: true,
      connectionId: agent.schedulingConfig.calendarConnectionId,
      config: {
        timezone: agent.schedulingConfig.timezone,
        availableHours: agent.schedulingConfig.availableHours,
        availableDays: agent.schedulingConfig.availableDays,
        defaultDurationMinutes: agent.schedulingConfig.defaultDurationMinutes,
        bufferMinutes: agent.schedulingConfig.bufferMinutes,
        meetingTitleTemplate: agent.schedulingConfig.meetingTitleTemplate,
        meetingDescription: agent.schedulingConfig.meetingDescription,
        createMeetLink: agent.schedulingConfig.createMeetLink
      }
    })
  }

  if (agent.bookingConfig?.enabled && agent.bookingConfig.resources.length > 0) {
    actions.push({
      id: 'legacy-booking',
      type: 'booking',
      enabled: true,
      config: {
        mode: agent.bookingConfig.mode ?? 'enquiry',
        resources: agent.bookingConfig.resources,
        eventTitleTemplate: agent.bookingConfig.eventTitleTemplate ?? '{guest_name} ({guest_count} guests)',
        eventTimeMode: agent.bookingConfig.eventTimeMode ?? 'all-day',
        overlapProtection: agent.bookingConfig.overlapProtection !== false
      }
    })
  }

  if (agent.dataConfig?.enabled && agent.dataConfig.dataConnectionId) {
    actions.push({
      id: 'legacy-data',
      type: 'data',
      enabled: true,
      connectionId: agent.dataConfig.dataConnectionId,
      config: {
        fieldMappings: agent.dataConfig.fieldMappings,
        updateKeyField: agent.dataConfig.updateKeyField,
        allowQuery: false,
        allowDelete: false,
        autoSubmitOnComplete: agent.dataConfig.autoSubmitOnComplete
      }
    })
  }

  return actions
}

/**
 * Inject action tools into a toolkit by iterating through agent.actions
 * and delegating to the registry. Replaces all if/else blocks in context-builder.
 */
export async function injectActionTools(
  agent: VibeAgent,
  toolkit: { functions: any[]; executors: Record<string, any> }
): Promise<void> {
  const actions: AgentAction[] = agent.actions ?? buildLegacyActions(agent)

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
