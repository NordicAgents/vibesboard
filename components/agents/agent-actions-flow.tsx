'use client'

import { useState } from 'react'
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
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
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
}

const SECTION_IDS: Record<ActionCapability, string> = {
  availability_only: 'actions-availability-only',
  scheduling: 'actions-scheduling-source',
  booking: 'actions-booking-resources',
  data: 'actions-data-sync'
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
// is off" — which silently disables every booking tool. Render it as an
// unmistakable "Configured · OFF" so owners notice the agent has no tools.
function getBookingBadgeVariant(state: ActionCapabilityState) {
  if (state.status === 'ready') return 'outline' as const
  return getStatusBadgeVariant(state)
}

function getBookingBadgeLabel(state: ActionCapabilityState) {
  if (state.status === 'ready') return 'Configured · OFF'
  return state.statusLabel
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
  initialCapability = 'booking'
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

  const jumpToCapability = (capability: ActionCapability) => {
    setActiveCapability(capability)
    const section = document.getElementById(SECTION_IDS[capability])
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const activeSectionClass = (capability: ActionCapability) =>
    cn(
      'scroll-mt-24 rounded-2xl border p-4',
      activeCapability === capability
        ? 'border-primary/30 bg-primary/5'
        : 'border-border bg-card'
    )

  return (
    <div className="space-y-6 pb-8">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Choose Capabilities</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Configure the capability you need, then use the summaries below to
            see what is ready, what is enabled, and what still needs work.
          </p>

          <div className="grid gap-3 md:grid-cols-2">
            {states.map(state => (
              <button
                key={state.capability}
                type="button"
                onClick={() => jumpToCapability(state.capability)}
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
                  <Badge
                    variant={
                      state.capability === 'booking'
                        ? getBookingBadgeVariant(state)
                        : getStatusBadgeVariant(state)
                    }
                  >
                    {state.capability === 'booking'
                      ? getBookingBadgeLabel(state)
                      : state.statusLabel}
                  </Badge>
                </div>
                {state.blocker && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {state.blocker}
                  </p>
                )}
                {state.capability === 'booking' &&
                  state.status === 'ready' && (
                    <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                      Booking tools will not be available to the agent until
                      the master toggle is on.
                    </p>
                  )}
                <div className="mt-4">
                  <span className="text-xs font-medium text-foreground">
                    {state.ctaLabel}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Configure Availability Sources
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Start with the calendar source each capability should use.
            Availability Only is the legacy single-resource path. Simple Booking
            is the recommended multi-resource booking setup.
          </p>
        </CardContent>
      </Card>

      <div
        id={SECTION_IDS.availability_only}
        className={activeSectionClass('availability_only')}
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Availability Only</p>
            <p className="text-sm text-muted-foreground">
              Legacy single-resource availability check for one calendar.
            </p>
          </div>
          <Badge variant={getStatusBadgeVariant(stateMap.availability_only)}>
            {stateMap.availability_only.statusLabel}
          </Badge>
        </div>
        {bookingConfig?.enabled && calendarAvailabilityConfig?.enabled && (
          <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Simple Booking is active — Availability Only is ignored at runtime.
            Disable one to remove this warning.
          </p>
        )}
        <AgentCalendarAvailabilitySettings
          config={calendarAvailabilityConfig}
          onChange={onCalendarAvailabilityConfigChange}
          disabled={disabled}
          tenantId={tenantId}
        />
      </div>

      <div
        id={SECTION_IDS.scheduling}
        className={activeSectionClass('scheduling')}
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Scheduling Calendar</p>
            <p className="text-sm text-muted-foreground">
              Choose the one calendar used for appointment scheduling.
            </p>
          </div>
          <Badge variant={getStatusBadgeVariant(stateMap.scheduling)}>
            {stateMap.scheduling.statusLabel}
          </Badge>
        </div>
        <AgentSchedulingSettings
          config={schedulingConfig}
          onChange={onSchedulingConfigChange}
          disabled={disabled}
          tenantId={tenantId}
          section="source"
        />
      </div>

      <div id={SECTION_IDS.booking} className={activeSectionClass('booking')}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Bookable Resources</p>
            <p className="text-sm text-muted-foreground">
              Add each room or property calendar the owner buddy should manage.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end gap-0.5">
              <span
                className="text-xs font-medium text-muted-foreground"
                title={
                  bookingConfig && bookingConfig.resources.length > 0
                    ? 'Master toggle — when off, the agent has no booking tools.'
                    : 'Add at least one resource first'
                }
              >
                Booking tools
              </span>
              <Switch
                checked={!!bookingConfig?.enabled}
                disabled={
                  disabled ||
                  !bookingConfig ||
                  bookingConfig.resources.length === 0
                }
                onCheckedChange={enabled => {
                  if (!bookingConfig) return
                  onBookingConfigChange({ ...bookingConfig, enabled })
                }}
              />
            </div>
            <Badge variant={getBookingBadgeVariant(stateMap.booking)}>
              {getBookingBadgeLabel(stateMap.booking)}
            </Badge>
          </div>
        </div>
        {stateMap.booking.status === 'ready' && (
          <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Booking is configured but the master toggle above is off — the agent
            has no booking tools and cannot create, update, or cancel
            reservations.
          </p>
        )}
        <AgentBookingResourceConfig
          config={bookingConfig}
          onChange={onBookingConfigChange}
          disabled={disabled}
          tenantId={tenantId}
          section="resources"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Configure Behavior</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Once the source calendars are chosen, enable the capability and tune
            how the agent behaves.
          </p>
        </CardContent>
      </Card>

      <div className={activeSectionClass('scheduling')}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Scheduling Rules</p>
            <p className="text-sm text-muted-foreground">
              Scheduling is for meetings and appointments, not room bookings.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => jumpToCapability('scheduling')}
            disabled={disabled}
          >
            {stateMap.scheduling.ctaLabel}
          </Button>
        </div>
        <AgentSchedulingSettings
          config={schedulingConfig}
          onChange={onSchedulingConfigChange}
          disabled={disabled}
          tenantId={tenantId}
          section="behavior"
        />
      </div>

      <div className={activeSectionClass('booking')}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Simple Booking Rules</p>
            <p className="text-sm text-muted-foreground">
              Direct and enquiry modes are both supported. This is the main
              resort-booking path.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => jumpToCapability('booking')}
            disabled={disabled}
          >
            {stateMap.booking.ctaLabel}
          </Button>
        </div>
        <AgentBookingResourceConfig
          config={bookingConfig}
          onChange={onBookingConfigChange}
          disabled={disabled}
          tenantId={tenantId}
          section="behavior"
        />
      </div>

      <div id={SECTION_IDS.data} className={activeSectionClass('data')}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Optional Data Sync</p>
            <p className="text-sm text-muted-foreground">
              Keep this independent. Use it only if the agent also needs to send
              or update data elsewhere.
            </p>
          </div>
          <Badge variant={getStatusBadgeVariant(stateMap.data)}>
            {stateMap.data.statusLabel}
          </Badge>
        </div>
        <AgentDataSettings
          config={dataConfig}
          onChange={onDataConfigChange}
          disabled={disabled}
          tenantId={tenantId}
          collectionFields={collectionFields}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Review</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {states.map(state => (
            <div key={state.capability} className="rounded-xl border px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{state.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {state.summary}
                  </p>
                  {state.blocker && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {state.blocker}
                    </p>
                  )}
                </div>
                <Badge
                  variant={
                    state.capability === 'booking'
                      ? getBookingBadgeVariant(state)
                      : getStatusBadgeVariant(state)
                  }
                >
                  {state.capability === 'booking'
                    ? getBookingBadgeLabel(state)
                    : state.statusLabel}
                </Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
