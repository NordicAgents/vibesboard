'use client'

import { useEffect, useState } from 'react'
import type { AgentNotificationConfig, NotificationEvent } from '@/lib/firestore-types'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface Props {
  config: AgentNotificationConfig | undefined
  onChange: (config: AgentNotificationConfig) => void
  disabled: boolean
  tenantId: string
}

const DEFAULT_CONFIG: AgentNotificationConfig = {
  enabled: false,
  events: ['completed', 'handoff', 'agent_handoff'],
  inApp: { enabled: true },
  email: { enabled: false },
  webhook: { enabled: false }
}

const EVENT_LABELS: Record<NotificationEvent, string> = {
  completed: 'Completed',
  handoff: 'Handoff to Human',
  agent_handoff: 'Agent Transfer'
}

export function AgentNotificationSettings({
  config,
  onChange,
  disabled,
  tenantId
}: Props) {
  const current = config ?? DEFAULT_CONFIG

  const [subFlags, setSubFlags] = useState<Record<string, boolean>>({
    AGENT_NOTIFICATIONS_INAPP: true,
    AGENT_NOTIFICATIONS_EMAIL: false,
    AGENT_NOTIFICATIONS_WEBHOOK: false
  })

  useEffect(() => {
    const controller = new AbortController()

    async function loadFlags() {
      try {
        const res = await fetch(`/api/tenants/${tenantId}/config`, {
          signal: controller.signal
        })
        if (!res.ok) return
        const data = await res.json()
        const features = (data?.features ?? []) as Array<{
          name: string
          isEnabled: boolean
        }>

        const flags: Record<string, boolean> = {}
        for (const f of features) {
          if (f.name.startsWith('AGENT_NOTIFICATIONS_')) {
            flags[f.name] = f.isEnabled
          }
        }
        if (Object.keys(flags).length > 0) {
          setSubFlags(prev => ({ ...prev, ...flags }))
        }
      } catch {
        // ignore
      }
    }

    loadFlags()
    return () => controller.abort()
  }, [tenantId])

  const update = (patch: Partial<AgentNotificationConfig>) => {
    onChange({ ...current, ...patch })
  }

  const toggleEvent = (event: NotificationEvent) => {
    const events = current.events.includes(event)
      ? current.events.filter(e => e !== event)
      : [...current.events, event]
    update({ events })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Notifications</CardTitle>
        <CardDescription>
          Get notified when conversations end
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Master toggle */}
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">Enable notifications</p>
            <p className="text-xs text-muted-foreground">
              Send notifications on conversation events
            </p>
          </div>
          <Switch
            checked={current.enabled}
            disabled={disabled}
            onCheckedChange={enabled => update({ enabled })}
          />
        </div>

        {current.enabled && (
          <>
            {/* Event selection */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Events
              </p>
              <div className="flex gap-2">
                {(
                  Object.entries(EVENT_LABELS) as [NotificationEvent, string][]
                ).map(([event, label]) => (
                  <Badge
                    key={event}
                    variant={
                      current.events.includes(event) ? 'default' : 'secondary'
                    }
                    className={cn(
                      'cursor-pointer px-3 py-1.5 transition-all',
                      current.events.includes(event) &&
                        'bg-primary text-primary-foreground',
                      disabled && 'cursor-not-allowed opacity-60'
                    )}
                    onClick={() => {
                      if (!disabled) toggleEvent(event)
                    }}
                  >
                    {label}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Channels */}
            <div className="space-y-3">
              {/* In-app */}
              {subFlags.AGENT_NOTIFICATIONS_INAPP && (
                <div className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">In-app</p>
                      <p className="text-xs text-muted-foreground">
                        Show in notification bell
                      </p>
                    </div>
                    <Switch
                      checked={current.inApp?.enabled ?? false}
                      disabled={disabled}
                      onCheckedChange={enabled =>
                        update({ inApp: { enabled } })
                      }
                    />
                  </div>
                </div>
              )}

              {/* Email */}
              {subFlags.AGENT_NOTIFICATIONS_EMAIL && (
                <div className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Email</p>
                      <p className="text-xs text-muted-foreground">
                        Send email on events
                      </p>
                    </div>
                    <Switch
                      checked={current.email?.enabled ?? false}
                      disabled={disabled}
                      onCheckedChange={enabled =>
                        update({
                          email: { ...current.email, enabled }
                        })
                      }
                    />
                  </div>
                  {current.email?.enabled && (
                    <Input
                      value={current.email.address ?? ''}
                      onChange={e =>
                        update({
                          email: {
                            ...current.email,
                            enabled: true,
                            address: e.target.value || null
                          }
                        })
                      }
                      placeholder="Email address (blank = your account email)"
                      disabled={disabled}
                    />
                  )}
                </div>
              )}

              {/* Webhook */}
              {subFlags.AGENT_NOTIFICATIONS_WEBHOOK && (
                <div className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Webhook</p>
                      <p className="text-xs text-muted-foreground">
                        POST to URL on events
                      </p>
                    </div>
                    <Switch
                      checked={current.webhook?.enabled ?? false}
                      disabled={disabled}
                      onCheckedChange={enabled =>
                        update({
                          webhook: { ...current.webhook, enabled }
                        })
                      }
                    />
                  </div>
                  {current.webhook?.enabled && (
                    <>
                      <Input
                        value={current.webhook.url ?? ''}
                        onChange={e =>
                          update({
                            webhook: {
                              ...current.webhook,
                              enabled: true,
                              url: e.target.value || null
                            }
                          })
                        }
                        placeholder="https://example.com/webhook"
                        disabled={disabled}
                      />
                      <Input
                        type="password"
                        value={current.webhook.secret ?? ''}
                        onChange={e =>
                          update({
                            webhook: {
                              ...current.webhook,
                              enabled: true,
                              secret: e.target.value || null
                            }
                          })
                        }
                        placeholder="HMAC secret (optional)"
                        disabled={disabled}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
