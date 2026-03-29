'use client'

import { useEffect, useState } from 'react'
import type { AgentSchedulingConfig } from '@/lib/firestore-types'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { CalendarDays, Plus, Trash2 } from 'lucide-react'

interface CalendarConnectionSummary {
  id: string
  provider: string
  name: string
  email?: string
  status: string
}

const DEFAULT_CONFIG: AgentSchedulingConfig = {
  enabled: false,
  calendarConnectionId: null,
  defaultDurationMinutes: 30,
  bufferMinutes: 0,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  availableHours: { start: '09:00', end: '17:00' },
  availableDays: [1, 2, 3, 4, 5],
  meetingTitleTemplate: 'Meeting with {{name}}',
  createMeetLink: true
}

const DAY_LABELS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' }
]

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120]
const BUFFER_OPTIONS = [0, 5, 10, 15, 30]

interface Props {
  config: AgentSchedulingConfig | undefined
  onChange: (config: AgentSchedulingConfig) => void
  disabled: boolean
  tenantId: string
}

export function AgentSchedulingSettings({
  config,
  onChange,
  disabled,
  tenantId
}: Props) {
  const current = config ?? DEFAULT_CONFIG
  const [connections, setConnections] = useState<CalendarConnectionSummary[]>([])
  const [loadingConnections, setLoadingConnections] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const res = await fetch('/api/scheduling/connections', {
          signal: controller.signal
        })
        if (!res.ok) return
        const data = await res.json()
        setConnections(data.connections ?? [])
      } catch {
        // ignore
      } finally {
        setLoadingConnections(false)
      }
    }
    load()
    return () => controller.abort()
  }, [tenantId])

  const update = (patch: Partial<AgentSchedulingConfig>) => {
    onChange({ ...current, ...patch })
  }

  const toggleDay = (day: number) => {
    const days = current.availableDays.includes(day)
      ? current.availableDays.filter(d => d !== day)
      : [...current.availableDays, day].sort((a, b) => a - b)
    update({ availableDays: days })
  }

  const handleConnect = () => {
    window.location.href = '/api/scheduling/auth/google'
  }

  const handleDisconnect = async (connectionId: string) => {
    try {
      await fetch(`/api/scheduling/connections/${connectionId}`, {
        method: 'DELETE'
      })
      setConnections(prev => prev.filter(c => c.id !== connectionId))
      if (current.calendarConnectionId === connectionId) {
        update({ calendarConnectionId: null, enabled: false })
      }
    } catch {
      // ignore
    }
  }

  const activeConnections = connections.filter(c => c.status === 'active')

  return (
    <div className="space-y-5 pb-8">
      {/* Calendar Connections */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Calendar Connection</CardTitle>
          <CardDescription>
            Connect a Google Calendar to enable scheduling
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingConnections ? (
            <div className="flex h-16 items-center justify-center">
              <p className="text-xs text-muted-foreground">Loading...</p>
            </div>
          ) : (
            <>
              {connections.map(conn => (
                <div
                  key={conn.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <CalendarDays className="size-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{conn.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {conn.provider === 'google_calendar'
                          ? 'Google Calendar'
                          : conn.provider}{' '}
                        &middot; {conn.status}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {conn.status === 'active' && (
                      <input
                        type="radio"
                        name="calendar-connection"
                        checked={current.calendarConnectionId === conn.id}
                        onChange={() =>
                          update({ calendarConnectionId: conn.id })
                        }
                        disabled={disabled}
                        className="accent-primary"
                      />
                    )}
                    <button
                      onClick={() => handleDisconnect(conn.id)}
                      disabled={disabled}
                      className="rounded-md p-1 text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}

              <Button
                variant="outline"
                size="sm"
                onClick={handleConnect}
                disabled={disabled}
                className="w-full"
              >
                <Plus className="mr-1.5 size-3.5" />
                Connect Google Calendar
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Enable Toggle */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Scheduling</CardTitle>
          <CardDescription>
            Let your agent check availability and book meetings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Enable scheduling</p>
              <p className="text-xs text-muted-foreground">
                {activeConnections.length === 0
                  ? 'Connect a calendar first'
                  : 'Agent can check availability and book meetings'}
              </p>
            </div>
            <Switch
              checked={current.enabled}
              disabled={
                disabled || activeConnections.length === 0 || !current.calendarConnectionId
              }
              onCheckedChange={enabled => update({ enabled })}
            />
          </div>

          {current.enabled && (
            <>
              {/* Default Duration */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Default Meeting Duration
                </label>
                <select
                  value={current.defaultDurationMinutes}
                  onChange={e =>
                    update({
                      defaultDurationMinutes: Number(e.target.value)
                    })
                  }
                  disabled={disabled}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                >
                  {DURATION_OPTIONS.map(d => (
                    <option key={d} value={d}>
                      {d} minutes
                    </option>
                  ))}
                </select>
              </div>

              {/* Buffer Time */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Buffer Between Meetings
                </label>
                <select
                  value={current.bufferMinutes}
                  onChange={e =>
                    update({ bufferMinutes: Number(e.target.value) })
                  }
                  disabled={disabled}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                >
                  {BUFFER_OPTIONS.map(b => (
                    <option key={b} value={b}>
                      {b === 0 ? 'No buffer' : `${b} minutes`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Timezone */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Timezone
                </label>
                <Input
                  value={current.timezone}
                  onChange={e => update({ timezone: e.target.value })}
                  placeholder="e.g. America/New_York"
                  disabled={disabled}
                />
              </div>

              {/* Available Hours */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Available Hours
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={current.availableHours.start}
                    onChange={e =>
                      update({
                        availableHours: {
                          ...current.availableHours,
                          start: e.target.value
                        }
                      })
                    }
                    disabled={disabled}
                    className="w-32"
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <Input
                    type="time"
                    value={current.availableHours.end}
                    onChange={e =>
                      update({
                        availableHours: {
                          ...current.availableHours,
                          end: e.target.value
                        }
                      })
                    }
                    disabled={disabled}
                    className="w-32"
                  />
                </div>
              </div>

              {/* Available Days */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Available Days
                </label>
                <div className="flex flex-wrap gap-2">
                  {DAY_LABELS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => !disabled && toggleDay(value)}
                      disabled={disabled}
                      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                        current.availableDays.includes(value)
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted'
                      } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Meeting Title Template */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Meeting Title Template
                </label>
                <Input
                  value={current.meetingTitleTemplate}
                  onChange={e =>
                    update({ meetingTitleTemplate: e.target.value })
                  }
                  placeholder="Meeting with {{name}}"
                  disabled={disabled}
                />
                <p className="text-[10px] text-muted-foreground">
                  Use {'{{name}}'} for the attendee&apos;s name
                </p>
              </div>

              {/* Google Meet Link Toggle */}
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">Create Google Meet link</p>
                  <p className="text-xs text-muted-foreground">
                    Auto-generate a video meeting link for each booking
                  </p>
                </div>
                <Switch
                  checked={current.createMeetLink}
                  disabled={disabled}
                  onCheckedChange={createMeetLink =>
                    update({ createMeetLink })
                  }
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
