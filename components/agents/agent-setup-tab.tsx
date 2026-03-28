'use client'

import type { AgentMode, QuickSuggestionsMode } from '@/lib/types'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface AgentSetupTabProps {
  name: string
  onNameChange: (value: string) => void
  instructions: string
  onInstructionsChange: (value: string) => void
  greetingText: string
  onGreetingTextChange: (value: string) => void
  allowAnonymous: boolean
  onAllowAnonymousChange: (value: boolean) => void
  mode: AgentMode
  onModeChange: (value: AgentMode) => void
  maxResponses: number | null
  onMaxResponsesChange: (value: number | null) => void
  maxAgentResponses: number | null
  onMaxAgentResponsesChange: (value: number | null) => void
  totalResponseCount?: number
  quickSuggestionsMode: QuickSuggestionsMode
  onQuickSuggestionsModeChange: (value: QuickSuggestionsMode) => void
  quickSuggestionsCount: number
  onQuickSuggestionsCountChange: (value: number) => void
  tenantSlug?: string
  agentUrl: string
  saving: boolean
  canEdit: boolean
}

export function AgentSetupTab({
  name,
  onNameChange,
  instructions,
  onInstructionsChange,
  greetingText,
  onGreetingTextChange,
  allowAnonymous,
  onAllowAnonymousChange,
  mode,
  onModeChange,
  maxResponses,
  onMaxResponsesChange,
  maxAgentResponses,
  onMaxAgentResponsesChange,
  totalResponseCount,
  quickSuggestionsMode,
  onQuickSuggestionsModeChange,
  quickSuggestionsCount,
  onQuickSuggestionsCountChange,
  tenantSlug,
  agentUrl,
  saving,
  canEdit
}: AgentSetupTabProps) {
  return (
    <div className="space-y-5 pb-8">
      {/* Agent card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Agent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Input
              value={name}
              disabled={saving || !canEdit}
              onChange={e => onNameChange(e.target.value)}
              placeholder="Agent name"
            />
            <div className="flex items-center justify-between">
              <p className="truncate text-xs text-muted-foreground">
                /{tenantSlug ?? 'unknown'}/{agentUrl}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Allow anonymous chat</p>
              <p className="text-xs text-muted-foreground">
                Require sign-in when disabled.
              </p>
            </div>
            <Switch
              checked={allowAnonymous}
              disabled={saving || !canEdit}
              onCheckedChange={onAllowAnonymousChange}
            />
          </div>
        </CardContent>
      </Card>

      {/* Instructions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Instructions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={instructions}
            onChange={e => onInstructionsChange(e.target.value)}
            rows={6}
            placeholder="Explain how the agent should behave, tone, and guardrails."
            disabled={saving || !canEdit}
          />
        </CardContent>
      </Card>

      {/* Greeting */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Greeting</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={greetingText}
            onChange={e => onGreetingTextChange(e.target.value)}
            placeholder="Initial greeting message"
            rows={3}
            disabled={saving || !canEdit}
          />
        </CardContent>
      </Card>

      {/* Agent Mode */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Agent Mode</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Badge
              variant={mode !== 'collector' ? 'default' : 'secondary'}
              className={cn(
                'flex-1 cursor-pointer justify-center py-2 transition-all',
                mode !== 'collector' && 'bg-primary text-primary-foreground',
                !canEdit && 'cursor-not-allowed opacity-60'
              )}
              onClick={() => {
                if (!canEdit) return
                onModeChange('provider')
              }}
            >
              Info Provider
            </Badge>
            <Badge
              variant={mode === 'collector' ? 'default' : 'secondary'}
              className={cn(
                'flex-1 cursor-pointer justify-center py-2 transition-all',
                mode === 'collector' && 'bg-primary text-primary-foreground',
                !canEdit && 'cursor-not-allowed opacity-60'
              )}
              onClick={() => {
                if (!canEdit) return
                onModeChange('collector')
              }}
            >
              Info Collector
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {mode === 'collector'
              ? 'Agent will gather information from users'
              : 'Agent will provide information to users'}
          </p>
        </CardContent>
      </Card>

      {/* Response Limits */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Response Limits</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Max responses per session
            </label>
            <Input
              type="number"
              min={1}
              max={500}
              value={maxResponses ?? ''}
              onChange={e => {
                const val = parseInt(e.target.value, 10)
                onMaxResponsesChange(val > 0 ? val : null)
              }}
              className="mt-1"
              disabled={saving || !canEdit}
              placeholder="Unlimited"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Max AI responses in a single conversation. Leave empty for unlimited.
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Max responses per agent
            </label>
            <Input
              type="number"
              min={1}
              max={100000}
              value={maxAgentResponses ?? ''}
              onChange={e => {
                const val = parseInt(e.target.value, 10)
                onMaxAgentResponsesChange(val > 0 ? val : null)
              }}
              className="mt-1"
              disabled={saving || !canEdit}
              placeholder="Unlimited"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Total AI responses across all sessions. Agent is disabled when reached.
            </p>
            {maxAgentResponses != null && totalResponseCount != null && (
              <p className="mt-1 text-xs font-medium text-muted-foreground">
                Used: {totalResponseCount} / {maxAgentResponses}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Quick Suggestions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Quick Suggestions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Badge
              variant={
                quickSuggestionsMode === 'off' ? 'default' : 'secondary'
              }
              className={cn(
                'flex-1 cursor-pointer justify-center py-2 transition-all',
                quickSuggestionsMode === 'off' &&
                  'bg-primary text-primary-foreground',
                !canEdit && 'cursor-not-allowed opacity-60'
              )}
              onClick={() => {
                if (!canEdit) return
                onQuickSuggestionsModeChange('off')
              }}
            >
              Off
            </Badge>
            <Badge
              variant={
                quickSuggestionsMode === 'smart' ? 'default' : 'secondary'
              }
              className={cn(
                'flex-1 cursor-pointer justify-center py-2 transition-all',
                quickSuggestionsMode === 'smart' &&
                  'bg-primary text-primary-foreground',
                !canEdit && 'cursor-not-allowed opacity-60'
              )}
              onClick={() => {
                if (!canEdit) return
                onQuickSuggestionsModeChange('smart')
              }}
            >
              Smart
            </Badge>
            <Badge
              variant={
                quickSuggestionsMode === 'always' ? 'default' : 'secondary'
              }
              className={cn(
                'flex-1 cursor-pointer justify-center py-2 transition-all',
                quickSuggestionsMode === 'always' &&
                  'bg-primary text-primary-foreground',
                !canEdit && 'cursor-not-allowed opacity-60'
              )}
              onClick={() => {
                if (!canEdit) return
                onQuickSuggestionsModeChange('always')
              }}
            >
              Always
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {quickSuggestionsMode === 'off'
              ? 'No suggestions will be shown.'
              : quickSuggestionsMode === 'always'
                ? 'Suggestions appear after every agent reply.'
                : 'Suggestions appear when helpful (start + questions).'}
          </p>
          {quickSuggestionsMode !== 'off' && (
            <div className="pt-1">
              <label className="text-xs font-medium text-muted-foreground">
                Suggestions count
              </label>
              <div className="mt-2">
                <Input
                  type="number"
                  min={1}
                  max={5}
                  disabled={!canEdit}
                  value={quickSuggestionsCount}
                  onChange={e =>
                    onQuickSuggestionsCountChange(
                      Math.max(1, Math.min(5, parseInt(e.target.value) || 4))
                    )
                  }
                  className="h-9 w-20 text-center"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
