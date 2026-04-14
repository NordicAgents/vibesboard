import type { ActionModule, ActionContext, AgentAction } from './types'
import type { RegisteredTool } from '@/lib/agent/tools/base'
import type { VibeAgent } from '@/lib/types'
import { isFeatureEnabled } from '@/lib/features'
import { AppointmentsModule } from './appointments'
import { BookingModule } from './booking'
import { DataModule } from './data'

const ACTION_REGISTRY: Record<string, ActionModule> = {
  appointments: AppointmentsModule,
  booking: BookingModule,
  data: DataModule,
}

function buildLegacyAppointmentsAction(agent: VibeAgent): AgentAction | null {
  const cfg = agent.schedulingConfig
  if (!cfg?.enabled || !cfg.calendarConnectionId) return null
  return {
    id: 'legacy-appointments',
    type: 'appointments',
    enabled: true,
    connectionId: cfg.calendarConnectionId,
    config: {
      timezone: cfg.timezone,
      availableHours: cfg.availableHours,
      availableDays: cfg.availableDays,
      defaultDurationMinutes: cfg.defaultDurationMinutes,
      bufferMinutes: cfg.bufferMinutes,
      meetingTitleTemplate: cfg.meetingTitleTemplate,
      meetingDescription: cfg.meetingDescription,
      createMeetLink: cfg.createMeetLink
    }
  }
}

function buildLegacyBookingConfigAction(agent: VibeAgent): AgentAction | null {
  const bc = agent.bookingConfig
  if (!bc?.enabled || bc.resources.length === 0) return null
  return {
    id: 'legacy-booking',
    type: 'booking',
    enabled: true,
    config: {
      mode: bc.mode ?? 'enquiry',
      resources: bc.resources,
      eventTitleTemplate: bc.eventTitleTemplate ?? '{guest_name} ({guest_count} guests)',
      eventTimeMode: bc.eventTimeMode ?? 'all-day',
      overlapProtection: bc.overlapProtection !== false
    }
  }
}

function buildLegacyCalendarAvailabilityAction(agent: VibeAgent): AgentAction | null {
  const ca = agent.calendarAvailabilityConfig
  if (!ca?.enabled || !ca.calendarConnectionId) return null
  return {
    id: 'legacy-calendar-availability',
    type: 'booking',
    enabled: true,
    config: {
      mode: 'enquiry',
      resources: [{
        id: 'legacy-resource',
        name: ca.resourceName ?? 'Resource',
        calendarConnectionId: ca.calendarConnectionId,
        calendarId: ca.calendarId ?? '',
        calendarName: ca.resourceName ?? 'Calendar',
        timezone: 'UTC'
      }],
      eventTitleTemplate: '{guest_name} ({guest_count} guests)',
      eventTimeMode: 'all-day',
      overlapProtection: true
    }
  }
}

function buildLegacyBookingAction(agent: VibeAgent): AgentAction | null {
  return buildLegacyBookingConfigAction(agent) ?? buildLegacyCalendarAvailabilityAction(agent)
}

function buildLegacyDataAction(agent: VibeAgent): AgentAction | null {
  const cfg = agent.dataConfig
  if (!cfg?.enabled || !cfg.dataConnectionId) return null
  return {
    id: 'legacy-data',
    type: 'data',
    enabled: true,
    connectionId: cfg.dataConnectionId,
    config: {
      fieldMappings: cfg.fieldMappings,
      updateKeyField: cfg.updateKeyField,
      allowQuery: false,
      allowDelete: false,
      autoSubmitOnComplete: cfg.autoSubmitOnComplete
    }
  }
}

/**
 * Build an AgentAction[] from the legacy config fields for backward compatibility.
 * Only used during the migration transition period.
 */
function buildLegacyActions(agent: VibeAgent): AgentAction[] {
  return [
    buildLegacyAppointmentsAction(agent),
    buildLegacyBookingAction(agent),
    buildLegacyDataAction(agent),
  ].filter((a): a is AgentAction => a !== null)
}

/**
 * Inject action tools into a toolkit by iterating through agent.actions
 * and delegating to the registry. Replaces all if/else blocks in context-builder.
 */
export async function injectActionTools(
  agent: VibeAgent,
  toolkit: { functions: any[]; executors: Record<string, any> }
): Promise<void> {
  if (!agent.tenantId) return

  const enabled = await isFeatureEnabled(agent.tenantId, 'AGENT_ACTIONS')
  if (!enabled) return

  const actions: AgentAction[] = agent.actions ?? buildLegacyActions(agent)

  for (const action of actions) {
    if (!action.enabled) continue

    const actionModule = ACTION_REGISTRY[action.type]
    if (!actionModule) continue

    try {
      const ctx: ActionContext = { agent, action }
      const tools: RegisteredTool[] = await actionModule.buildTools(ctx)

      for (const tool of tools) {
        toolkit.functions.push(tool.function)
        toolkit.executors[tool.function.name] = tool.execute
      }
    } catch (err) {
      console.error(`Failed to inject ${action.type} tools:`, err)
    }
  }
}
