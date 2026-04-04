'use client'

import { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import type { AgentCalendarAvailabilityConfig } from '@/lib/firestore-types'
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

interface GoogleCalendarItem {
  id: string
  summary: string
  primary: boolean
}

const DEFAULT_CONFIG: AgentCalendarAvailabilityConfig = {
  enabled: false,
  calendarConnectionId: null,
  calendarId: null,
  resourceName: ''
}

interface Props {
  config: AgentCalendarAvailabilityConfig | undefined
  onChange: (config: AgentCalendarAvailabilityConfig) => void
  disabled: boolean
  tenantId: string
}

export function AgentCalendarAvailabilitySettings({
  config,
  onChange,
  disabled,
  tenantId
}: Props) {
  const current = config ?? DEFAULT_CONFIG
  const [connections, setConnections] = useState<CalendarConnectionSummary[]>([])
  const [loadingConnections, setLoadingConnections] = useState(true)
  const [calendars, setCalendars] = useState<GoogleCalendarItem[]>([])
  const [loadingCalendars, setLoadingCalendars] = useState(false)

  // Load connections on mount
  useEffect(() => {
    let mounted = true
    const controller = new AbortController()

    async function load() {
      try {
        const res = await fetch('/api/scheduling/connections', {
          signal: controller.signal
        })
        if (!res.ok) {
          if (mounted) toast.error('Failed to load calendar connections')
          return
        }
        const data = await res.json()
        const conns: CalendarConnectionSummary[] = data.connections ?? []

        if (!mounted) return
        setConnections(conns)

        // Auto-select only if nothing is already selected
        if (!current.calendarConnectionId) {
          const first = conns.find(c => c.status === 'active')
          if (first) onChange({ ...current, calendarConnectionId: first.id, calendarId: null })
        }
      } catch (err) {
        if (!mounted) return
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('[calendar-availability] Failed to load connections:', err.message)
          toast.error('Failed to load calendar connections')
        }
      } finally {
        if (mounted) setLoadingConnections(false)
      }
    }

    load()
    return () => {
      mounted = false
      controller.abort()
    }
  }, [tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load calendars whenever the selected connection changes
  useEffect(() => {
    if (!current.calendarConnectionId) {
      setCalendars([])
      return
    }

    let mounted = true
    const controller = new AbortController()
    setLoadingCalendars(true)

    async function load() {
      try {
        const res = await fetch(
          `/api/scheduling/connections/${current.calendarConnectionId}/calendars`,
          { signal: controller.signal }
        )

        if (!mounted) return

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          const code = data.code ?? 'UNKNOWN'
          if (code === 'TOKEN_EXPIRED') {
            toast.error('Calendar connection expired — please reconnect')
          } else {
            console.error('[calendar-availability] Failed to load calendars:', data.error)
          }
          return
        }

        const data = await res.json()
        const items: GoogleCalendarItem[] = data.calendars ?? []

        if (!mounted) return
        setCalendars(items)

        // Auto-select primary only if no calendarId is set yet
        if (!current.calendarId && items.length > 0) {
          const primary = items.find(c => c.primary) ?? items[0]
          onChange({ ...current, calendarId: primary.id })
        }
      } catch (err) {
        if (!mounted) return
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('[calendar-availability] Failed to load calendars:', err.message)
        }
      } finally {
        if (mounted) setLoadingCalendars(false)
      }
    }

    load()
    return () => {
      mounted = false
      controller.abort()
    }
  }, [current.calendarConnectionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch: Partial<AgentCalendarAvailabilityConfig>) => {
    onChange({ ...current, ...patch })
  }

  const handleConnect = () => {
    window.location.href = '/api/scheduling/auth/google'
  }

  const handleDisconnect = async (connectionId: string) => {
    try {
      const res = await fetch(`/api/scheduling/connections/${connectionId}`, {
        method: 'DELETE'
      })
      if (!res.ok) {
        toast.error('Failed to disconnect calendar')
        return
      }
      setConnections(prev => prev.filter(c => c.id !== connectionId))
      if (current.calendarConnectionId === connectionId) {
        update({ calendarConnectionId: null, calendarId: null, enabled: false })
        setCalendars([])
      }
    } catch (err) {
      console.error('[calendar-availability] Failed to disconnect:', err)
      toast.error('Failed to disconnect calendar')
    }
  }

  const activeConnections = connections.filter(c => c.status === 'active')
  const canEnable = activeConnections.length > 0 && !!current.calendarConnectionId && !!current.calendarId

  return (
    <div className="space-y-5 pb-8">
      {/* Calendar Connection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Calendar Connection</CardTitle>
          <CardDescription>
            Connect a Google Calendar — the agent will check this account for bookings
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
                        name="availability-calendar-connection"
                        checked={current.calendarConnectionId === conn.id}
                        onChange={() =>
                          update({ calendarConnectionId: conn.id, calendarId: null, enabled: false })
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

      {/* Calendar Picker */}
      {current.calendarConnectionId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Which Calendar to Check</CardTitle>
            <CardDescription>
              Select the calendar where bookings are recorded
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingCalendars ? (
              <div className="flex h-10 items-center">
                <p className="text-xs text-muted-foreground">Loading calendars...</p>
              </div>
            ) : calendars.length === 0 ? (
              <p className="text-xs text-muted-foreground">No calendars found.</p>
            ) : (
              <select
                value={current.calendarId ?? ''}
                onChange={e => { if (e.target.value) update({ calendarId: e.target.value }) }}
                disabled={disabled}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="" disabled>Select a calendar…</option>
                {calendars.map(cal => (
                  <option key={cal.id} value={cal.id}>
                    {cal.summary}{cal.primary ? ' (primary)' : ''}
                  </option>
                ))}
              </select>
            )}
          </CardContent>
        </Card>
      )}

      {/* Availability Config */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Availability Check</CardTitle>
          <CardDescription>
            Let your agent check if dates are free based on calendar events
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Enable availability check</p>
              <p className="text-xs text-muted-foreground">
                {!current.calendarConnectionId
                  ? 'Connect a calendar first'
                  : !current.calendarId
                  ? 'Select a calendar above'
                  : 'Agent can check if dates are available'}
              </p>
            </div>
            <Switch
              checked={current.enabled}
              disabled={disabled || !canEnable}
              onCheckedChange={enabled => update({ enabled })}
            />
          </div>

          {current.enabled && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Resource Name
              </label>
              <Input
                value={current.resourceName ?? ''}
                onChange={e => update({ resourceName: e.target.value })}
                placeholder="e.g. Glass Cabin, Conference Room A"
                disabled={disabled}
              />
              <p className="text-[10px] text-muted-foreground">
                Used in responses — e.g. &quot;Glass Cabin is available on those dates&quot;
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
