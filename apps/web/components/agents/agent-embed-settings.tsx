'use client'

import { useMemo, useState } from 'react'
import { Copy, Code2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card'
import { type VibeAgent } from '@/lib/types'
import { cn } from '@/lib/utils'

interface AgentEmbedSettingsProps {
  agent: VibeAgent
  canEdit: boolean
}

export function AgentEmbedSettings({
  agent,
  canEdit
}: AgentEmbedSettingsProps) {
  const [position, setPosition] = useState<'bottom-right' | 'bottom-left'>(
    'bottom-right'
  )
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [accentColor, setAccentColor] = useState('#a7e26e')
  const [copied, setCopied] = useState(false)

  const host =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://your-domain.com'

  const embedCode = useMemo(() => {
    const attrs = [`data-agent-id="${agent.id}"`]
    if (position !== 'bottom-right') attrs.push(`data-position="${position}"`)
    if (theme !== 'light') attrs.push(`data-theme="${theme}"`)
    if (accentColor !== '#a7e26e')
      attrs.push(`data-accent-color="${accentColor}"`)

    return `<script src="${host}/widget/embed.js" ${attrs.join(' ')}></script>`
  }, [agent.id, position, theme, accentColor, host])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(embedCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // noop
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Code2 className="size-4 text-muted-foreground" />
          <div>
            <CardTitle className="text-base">Embed on Website</CardTitle>
            <CardDescription className="mt-0.5 text-xs">
              Add a chat widget to any website with a single script tag.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!agent.allowAnonymous && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
            <p className="text-xs text-amber-800 dark:text-amber-400">
              Embedding requires &ldquo;Allow anonymous chat&rdquo; to be
              enabled. Turn it on in the Agent settings above.
            </p>
          </div>
        )}

        {/* Embed code snippet */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            Embed Code
          </label>
          <div className="relative rounded-md border bg-muted/50 p-3">
            <code className="block break-all font-mono text-[11px] leading-relaxed text-foreground/80">
              {embedCode}
            </code>
            <Button
              size="sm"
              variant="secondary"
              className="absolute right-2 top-2 h-7"
              onClick={handleCopy}
              disabled={!agent.allowAnonymous}
            >
              <Copy className="mr-1.5 size-3" />
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Paste this before the closing{' '}
            <code className="font-mono">&lt;/body&gt;</code> tag on your
            website.
          </p>
        </div>

        {/* Customization */}
        <div className="space-y-3 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">Customize</p>

          {/* Position */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground">
              Position
            </label>
            <div className="flex gap-2">
              <Badge
                variant={position === 'bottom-right' ? 'default' : 'secondary'}
                className={cn(
                  'flex-1 cursor-pointer justify-center py-1.5 transition-all',
                  position === 'bottom-right' &&
                    'bg-primary text-primary-foreground'
                )}
                onClick={() => setPosition('bottom-right')}
              >
                Bottom Right
              </Badge>
              <Badge
                variant={position === 'bottom-left' ? 'default' : 'secondary'}
                className={cn(
                  'flex-1 cursor-pointer justify-center py-1.5 transition-all',
                  position === 'bottom-left' &&
                    'bg-primary text-primary-foreground'
                )}
                onClick={() => setPosition('bottom-left')}
              >
                Bottom Left
              </Badge>
            </div>
          </div>

          {/* Theme */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground">Theme</label>
            <div className="flex gap-2">
              <Badge
                variant={theme === 'light' ? 'default' : 'secondary'}
                className={cn(
                  'flex-1 cursor-pointer justify-center py-1.5 transition-all',
                  theme === 'light' && 'bg-primary text-primary-foreground'
                )}
                onClick={() => setTheme('light')}
              >
                Light
              </Badge>
              <Badge
                variant={theme === 'dark' ? 'default' : 'secondary'}
                className={cn(
                  'flex-1 cursor-pointer justify-center py-1.5 transition-all',
                  theme === 'dark' && 'bg-primary text-primary-foreground'
                )}
                onClick={() => setTheme('dark')}
              >
                Dark
              </Badge>
            </div>
          </div>

          {/* Accent Color */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground">
              Accent Color
            </label>
            <div className="flex items-center gap-2">
              <div
                className="size-8 shrink-0 rounded-md border"
                style={{ backgroundColor: accentColor }}
              />
              <Input
                value={accentColor}
                onChange={e => setAccentColor(e.target.value)}
                placeholder="#a7e26e"
                className="h-8 font-mono text-xs"
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
