'use client'

import {
  MessageCircle,
  Code2,
  Webhook,
  Headphones,
  type LucideIcon
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { IntegrationDefinition } from '@/lib/integrations/types'

const ICON_MAP: Record<string, LucideIcon> = {
  MessageCircle,
  Code2,
  Webhook,
  Headphones
}

interface IntegrationCardProps {
  definition: IntegrationDefinition
  isSelected: boolean
  onSelect: () => void
  activeConnections?: number
  configured?: boolean
}

export function IntegrationCard({
  definition,
  isSelected,
  onSelect,
  activeConnections,
  configured
}: IntegrationCardProps) {
  const Icon = ICON_MAP[definition.icon]
  const isComingSoon = definition.status === 'coming_soon'
  const hasConnections = (activeConnections ?? 0) > 0
  const isConfigured = configured || hasConnections

  return (
    <Card
      className={cn(
        'cursor-pointer transition-all duration-150',
        isSelected && 'ring-2 ring-primary/30 border-primary/40',
        isComingSoon && 'opacity-60 cursor-default',
        !isComingSoon && 'hover:shadow-md hover:-translate-y-0.5'
      )}
      onClick={() => {
        if (!isComingSoon) onSelect()
      }}
    >
      <CardContent className="flex items-start gap-4 p-4">
        <div
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg',
            isConfigured
              ? 'bg-primary/10 text-primary'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {Icon && <Icon className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">{definition.name}</h3>
            {isComingSoon && (
              <Badge variant="secondary" className="text-[10px]">
                Coming soon
              </Badge>
            )}
            {hasConnections && (
              <Badge variant="default" className="text-[10px]">
                {activeConnections} active
              </Badge>
            )}
            {isConfigured && !hasConnections && (
              <Badge
                variant="secondary"
                className="border-green-200 bg-green-50 text-[10px] text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400"
              >
                Connected
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {definition.description}
          </p>
        </div>
        {!isComingSoon && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-xs"
            onClick={e => {
              e.stopPropagation()
              onSelect()
            }}
          >
            {isConfigured ? 'Manage' : 'Set up'}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
