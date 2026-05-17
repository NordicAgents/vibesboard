'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import type {
  AgentBookingConfig,
  AgentCalendarAvailabilityConfig,
  AgentDataConfig,
  AgentSchedulingConfig
} from '@/lib/firestore-types'
import type { CollectionField } from '@/lib/types'
import {
  getActionCapabilityStates,
  type ActionCapability,
  type ActionCapabilityState
} from '@/lib/agents/action-config'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AgentCalendarAvailabilitySettings } from './agent-calendar-availability-settings'
import { AgentSchedulingSettings } from './agent-scheduling-settings'
import { AgentBookingResourceConfig } from './agent-booking-resource-config'
import { AgentDataSettings } from './agent-data-settings'

interface Props {
  schedulingConfig: AgentSchedulingConfig | undefined
  onSchedulingConfigChange: (config: AgentSchedulingConfig) => void
  dataConfig: AgentDataConfig | undefined
  onDataConfigChange: (config: AgentDataConfig) => void
  calendarAvailabilityConfig: AgentCalendarAvailabilityConfig | undefined
  onCalendarAvailabilityConfigChange: (
    config: AgentCalendarAvailabilityConfig
  ) => void
  bookingConfig: AgentBookingConfig | undefined
  onBookingConfigChange: (config: AgentBookingConfig) => void
  disabled: boolean
  tenantId: string
  collectionFields: CollectionField[]
  initialCapability?: ActionCapability
  allowAnonymous: boolean
  onGoToSetup?: () => void
}

function getStatusBadgeVariant(state: ActionCapabilityState) {
  switch (state.status) {
    case 'enabled':
      return 'primary' as const
    case 'ready':
      return 'secondary' as const
    case 'needs_setup':
      return 'outline' as const
    default:
      return 'outline' as const
  }
}

// For the booking capability, "Ready" means "configured but the master toggle
// is off" — render it as an unmistakable "Configured · OFF" so owners notice
// the agent has no booking tools.
function getBookingBadgeVariant(state: ActionCapabilityState) {
  if (state.status === 'ready') return 'outline' as const
  return getStatusBadgeVariant(state)
}

function getBookingBadgeLabel(state: ActionCapabilityState) {
  if (state.status === 'ready') return 'Configured · OFF'
  return state.statusLabel
}

interface DetailPanelProps {
  title: string
  description: string
  state: ActionCapabilityState
  badgeVariant: ReturnType<typeof getStatusBadgeVariant>
  badgeLabel: string
  extraWarning?: string
  children: ReactNode
}

function DetailPanel({
  title,
  description,
  state,
  badgeVariant,
  badgeLabel,
  extraWarning,
  children
}: DetailPanelProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={badgeVariant}>{badgeLabel}</Badge>
          </div>
        </div>
        {state.blocker && (
          <p className="pt-2 text-xs text-muted-foreground">{state.blocker}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {extraWarning && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            {extraWarning}
          </p>
        )}
        {children}
      </CardContent>
    </Card>
  )
}

export function AgentActionsFlow({
  schedulingConfig,
  onSchedulingConfigChange,
  dataConfig,
  onDataConfigChange,
  calendarAvailabilityConfig,
  onCalendarAvailabilityConfigChange,
  bookingConfig,
  onBookingConfigChange,
  disabled,
  tenantId,
  collectionFields,
  initialCapability = 'booking',
  allowAnonymous,
  onGoToSetup
}: Props) {
  const [activeCapability, setActiveCapability] =
    useState<ActionCapability>(initialCapability)

  const states = getActionCapabilityStates({
    schedulingConfig,
    dataConfig,
    calendarAvailabilityConfig,
    bookingConfig
  })

  const stateMap = Object.fromEntries(
    states.map(state => [state.capability, state])
  ) as Record<ActionCapability, ActionCapabilityState>

  return (
    <div className="space-y-6 pb-8">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Choose Capabilities</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pick a capability to configure. Only the selected capability is
            shown below — switch any time.
          </p>

          <div className="grid gap-3 md:grid-cols-2">
            {states.map(state => {
              const isBooking = state.capability === 'booking'
              const variant = isBooking
                ? getBookingBadgeVariant(state)
                : getStatusBadgeVariant(state)
              const label = isBooking
                ? getBookingBadgeLabel(state)
                : state.statusLabel
              return (
                <button
                  key={state.capability}
                  type="button"
                  onClick={() => setActiveCapability(state.capability)}
                  className={cn(
                    'rounded-xl border p-4 text-left transition-colors',
                    activeCapability === state.capability
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border bg-card hover:bg-muted/40'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{state.title}</p>
                        {state.recommended && (
                          <Badge variant="outline">Recommended</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {state.summary}
                      </p>
                    </div>
                    <Badge variant={variant}>{label}</Badge>
                  </div>
                  {isBooking && state.status === 'ready' && (
                    <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                      Booking tools will not be available to the agent until
                      Enable simple booking is on.
                    </p>
                  )}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {activeCapability === 'availability_only' && (
        <DetailPanel
          title="Availability Only"
          description="Legacy single-resource availability check for one calendar."
          state={stateMap.availability_only}
          badgeVariant={getStatusBadgeVariant(stateMap.availability_only)}
          badgeLabel={stateMap.availability_only.statusLabel}
          extraWarning={
            bookingConfig?.enabled && calendarAvailabilityConfig?.enabled
              ? 'Simple Booking is active — Availability Only is ignored at runtime. Disable one to remove this warning.'
              : undefined
          }
        >
          <AgentCalendarAvailabilitySettings
            config={calendarAvailabilityConfig}
            onChange={onCalendarAvailabilityConfigChange}
            disabled={disabled}
            tenantId={tenantId}
          />
        </DetailPanel>
      )}

      {activeCapability === 'scheduling' && (
        <DetailPanel
          title="Scheduling"
          description="Meetings and 1:1 appointment booking — separate from room booking."
          state={stateMap.scheduling}
          badgeVariant={getStatusBadgeVariant(stateMap.scheduling)}
          badgeLabel={stateMap.scheduling.statusLabel}
        >
          <AgentSchedulingSettings
            config={schedulingConfig}
            onChange={onSchedulingConfigChange}
            disabled={disabled}
            tenantId={tenantId}
            section="all"
          />
        </DetailPanel>
      )}

      {activeCapability === 'booking' && (
        <DetailPanel
          title="Simple Booking"
          description="Resort or property booking — works with one or many resource calendars."
          state={stateMap.booking}
          badgeVariant={getBookingBadgeVariant(stateMap.booking)}
          badgeLabel={getBookingBadgeLabel(stateMap.booking)}
          extraWarning={
            stateMap.booking.status === 'ready'
              ? 'Booking is configured but Enable simple booking is off — the agent has no booking tools and cannot create, update, or cancel reservations.'
              : undefined
          }
        >
          <AgentBookingResourceConfig
            config={bookingConfig}
            onChange={onBookingConfigChange}
            disabled={disabled}
            tenantId={tenantId}
            section="all"
            allowAnonymous={allowAnonymous}
            onGoToSetup={onGoToSetup}
          />
        </DetailPanel>
      )}

      {activeCapability === 'data' && (
        <DetailPanel
          title="Data Sync"
          description="Optional — independent of booking and scheduling. Use for collecting or updating data elsewhere."
          state={stateMap.data}
          badgeVariant={getStatusBadgeVariant(stateMap.data)}
          badgeLabel={stateMap.data.statusLabel}
        >
          <AgentDataSettings
            config={dataConfig}
            onChange={onDataConfigChange}
            disabled={disabled}
            tenantId={tenantId}
            collectionFields={collectionFields}
          />
        </DetailPanel>
      )}
    </div>
  )
}
