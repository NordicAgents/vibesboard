'use client'

import { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import { nanoid } from 'nanoid'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card'
import { Trash2, Plus } from 'lucide-react'
import type {
  AgentBookingConfig,
  BookableResource
} from '@/lib/firestore-types'

interface CalendarConnectionSummary {
  id: string
  name: string
  status: string
}

interface GoogleCalendarItem {
  id: string
  summary: string
  primary: boolean
}

interface Props {
  config: AgentBookingConfig | undefined
  onChange: (config: AgentBookingConfig) => void
  disabled: boolean
  tenantId: string
  section?: 'all' | 'resources' | 'behavior'
}

const DEFAULT_CONFIG: AgentBookingConfig = {
  enabled: false,
  resources: [],
  mode: 'enquiry',
  eventTitleTemplate: '{guest_name} ({guest_count} guests)',
  eventTimeMode: 'all-day',
  overlapProtection: true
}

interface DraftResource {
  name: string
  calendarConnectionId: string
  calendarId: string
  calendarName: string
  timezone: string
}

const EMPTY_DRAFT: DraftResource = {
  name: '',
  calendarConnectionId: '',
  calendarId: '',
  calendarName: '',
  timezone: 'UTC'
}

const IANA_TIMEZONES: string[] =
  typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl
    ? (Intl as any).supportedValuesOf('timeZone')
    : [
        'UTC',
        'America/New_York',
        'America/Los_Angeles',
        'Europe/London',
        'Europe/Paris',
        'Asia/Kolkata',
        'Asia/Tokyo',
        'Australia/Sydney'
      ]

export function AgentBookingResourceConfig({
  config,
  onChange,
  disabled,
  tenantId,
  section = 'all'
}: Props) {
  const current = config ?? DEFAULT_CONFIG

  const [connections, setConnections] = useState<CalendarConnectionSummary[]>(
    []
  )
  const [loadingConnections, setLoadingConnections] = useState(true)

  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<DraftResource>(EMPTY_DRAFT)
  const [calendars, setCalendars] = useState<GoogleCalendarItem[]>([])
  const [loadingCalendars, setLoadingCalendars] = useState(false)

  // Load calendar connections on mount
  useEffect(() => {
    let mounted = true
    fetch('/api/scheduling/connections')
      .then(r => r.json())
      .then(data => {
        if (mounted) setConnections(data.connections ?? [])
      })
      .catch(() => toast.error('Failed to load calendar connections'))
      .finally(() => {
        if (mounted) setLoadingConnections(false)
      })
    return () => {
      mounted = false
    }
  }, [tenantId])

  // Load calendars when draft connection changes
  useEffect(() => {
    if (!draft.calendarConnectionId) {
      setCalendars([])
      return
    }
    let mounted = true
    setLoadingCalendars(true)
    fetch(`/api/scheduling/connections/${draft.calendarConnectionId}/calendars`)
      .then(r => r.json())
      .then(data => {
        if (!mounted) return
        const items: GoogleCalendarItem[] = data.calendars ?? []
        setCalendars(items)
        // Auto-select first calendar
        if (items.length > 0 && !draft.calendarId) {
          const first = items.find(c => c.primary) ?? items[0]
          setDraft(d => ({
            ...d,
            calendarId: first.id,
            calendarName: first.summary
          }))
        }
      })
      .catch(() =>
        toast.error('Could not load calendars — check your connection')
      )
      .finally(() => {
        if (mounted) setLoadingCalendars(false)
      })
    return () => {
      mounted = false
    }
  }, [draft.calendarConnectionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch: Partial<AgentBookingConfig>) =>
    onChange({ ...current, ...patch })

  const addResource = () => {
    if (
      !draft.name.trim() ||
      !draft.calendarConnectionId ||
      !draft.calendarId
    ) {
      toast.error(
        'Fill in resource name, connection, and calendar before adding.'
      )
      return
    }
    const tz = draft.timezone || 'UTC'
    const resource: BookableResource = {
      id: nanoid(),
      name: draft.name.trim(),
      calendarConnectionId: draft.calendarConnectionId,
      calendarId: draft.calendarId,
      calendarName: draft.calendarName,
      timezone: tz
    }
    update({ resources: [...current.resources, resource] })
    setDraft(EMPTY_DRAFT)
    setCalendars([])
    setAdding(false)
  }

  const removeResource = (id: string) => {
    const resources = current.resources.filter(r => r.id !== id)
    update({
      resources,
      enabled: resources.length > 0 ? current.enabled : false
    })
  }

  const activeConnections = connections.filter(c => c.status === 'active')
  const canEnable = current.resources.length > 0
  const showResources = section !== 'behavior'
  const showBehavior = section !== 'resources'

  return (
    <div className="space-y-5 pb-8">
      {showResources && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Bookable Resources</CardTitle>
            <CardDescription>
              Add one or more room or property calendars. Simple booking
              supports multiple resources and multiple calendars.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {current.resources.map(r => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.calendarName} · {r.timezone}
                  </p>
                </div>
                <button
                  onClick={() => removeResource(r.id)}
                  disabled={disabled}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}

            {adding ? (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Resource name
                  </label>
                  <Input
                    placeholder="e.g. Glass Cabin"
                    value={draft.name}
                    onChange={e =>
                      setDraft(d => ({ ...d, name: e.target.value }))
                    }
                    disabled={disabled}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Calendar connection
                  </label>
                  {loadingConnections ? (
                    <p className="text-xs text-muted-foreground">Loading...</p>
                  ) : (
                    <select
                      value={draft.calendarConnectionId}
                      onChange={e =>
                        setDraft(d => ({
                          ...d,
                          calendarConnectionId: e.target.value,
                          calendarId: '',
                          calendarName: ''
                        }))
                      }
                      disabled={disabled}
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    >
                      <option value="">Select a connection…</option>
                      {activeConnections.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {draft.calendarConnectionId && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Calendar
                    </label>
                    {loadingCalendars ? (
                      <p className="text-xs text-muted-foreground">
                        Loading calendars...
                      </p>
                    ) : (
                      <select
                        value={draft.calendarId}
                        onChange={e => {
                          const cal = calendars.find(
                            c => c.id === e.target.value
                          )
                          if (cal)
                            setDraft(d => ({
                              ...d,
                              calendarId: cal.id,
                              calendarName: cal.summary
                            }))
                        }}
                        disabled={disabled}
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                      >
                        <option value="">Select a calendar…</option>
                        {calendars.map(cal => (
                          <option key={cal.id} value={cal.id}>
                            {cal.summary}
                            {cal.primary ? ' (primary)' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Timezone
                  </label>
                  <select
                    value={draft.timezone}
                    onChange={e =>
                      setDraft(d => ({ ...d, timezone: e.target.value }))
                    }
                    disabled={disabled}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    {IANA_TIMEZONES.map(tz => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-2">
                  <Button size="sm" onClick={addResource} disabled={disabled}>
                    Add Resource
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setAdding(false)
                      setDraft(EMPTY_DRAFT)
                      setCalendars([])
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAdding(true)}
                disabled={disabled}
                className="w-full"
              >
                <Plus className="mr-1.5 size-3.5" />
                Add Resource
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {showBehavior && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Simple Booking</CardTitle>
              <CardDescription>
                Use this for resort room or property booking. It works with one
                or many resource calendars.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">Enable simple booking</p>
                  <p className="text-xs text-muted-foreground">
                    {canEnable
                      ? 'Agent can use the configured resources for booking.'
                      : 'Simple booking needs at least one bookable resource before it can be enabled.'}
                  </p>
                </div>
                <Switch
                  checked={current.enabled}
                  disabled={disabled || !canEnable}
                  onCheckedChange={enabled => update({ enabled })}
                />
              </div>
            </CardContent>
          </Card>

          {current.enabled && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Booking Mode</CardTitle>
                <CardDescription>
                  Choose whether the agent handles guest enquiries or direct
                  owner booking management.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Mode
                  </label>
                  <select
                    value={current.mode ?? 'enquiry'}
                    onChange={e =>
                      update({ mode: e.target.value as 'enquiry' | 'direct' })
                    }
                    disabled={disabled}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="enquiry">
                      Enquiry — guests submit booking requests
                    </option>
                    <option value="direct">
                      Direct — owner manages bookings via chat
                    </option>
                  </select>
                </div>

                {current.mode === 'direct' && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">
                        Event title template
                      </label>
                      <Input
                        placeholder="{guest_name} ({guest_count} guests)"
                        value={
                          current.eventTitleTemplate ??
                          '{guest_name} ({guest_count} guests)'
                        }
                        onChange={e =>
                          update({ eventTitleTemplate: e.target.value })
                        }
                        disabled={disabled}
                      />
                      <p className="text-xs text-muted-foreground">
                        Use {'{guest_name}'} and {'{guest_count}'} as
                        placeholders.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">
                        Event time mode
                      </label>
                      <select
                        value={current.eventTimeMode ?? 'all-day'}
                        onChange={e =>
                          update({
                            eventTimeMode: e.target.value as 'all-day' | 'timed'
                          })
                        }
                        disabled={disabled}
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                      >
                        <option value="all-day">
                          All-day events (date only)
                        </option>
                        <option value="timed">
                          Timed events (2pm check-in, 11am check-out)
                        </option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <p className="text-sm font-medium">
                          Overlap protection
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Block bookings that overlap with existing events
                        </p>
                      </div>
                      <Switch
                        checked={current.overlapProtection !== false}
                        disabled={disabled}
                        onCheckedChange={overlapProtection =>
                          update({ overlapProtection })
                        }
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
