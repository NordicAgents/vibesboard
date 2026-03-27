'use client'

import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { IconSparkles, IconCheck, IconX, IconPlus } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import { type AgentToolType, type AgentMode, type RetrievalStrategy } from '@/lib/types'
import { BUILTIN_AGENT_TOOLS } from '@/lib/agents/constants'

export interface AgentFormData {
  name?: string
  instructions?: string
  greetingText?: string
  allowAnonymous?: boolean
  tools?: AgentToolType[]
  fileKeys?: string[]
  sourceUrls?: string[]
  mode?: AgentMode
  maxMessages?: number | null
  quickSuggestionsMode?: 'off' | 'smart' | 'always'
  quickSuggestionsCount?: number
  retrievalStrategy?: RetrievalStrategy
}

const RETRIEVAL_OPTIONS: { value: RetrievalStrategy; label: string; hint: string }[] = [
  { value: 'direct', label: 'Direct', hint: 'Load full files into context.' },
  { value: 'rag', label: 'RAG', hint: 'Vector search on demand.' },
  { value: 'bash', label: 'Bash', hint: 'Shell commands in a sandbox.' }
]

interface AgentBuilderFormPreviewProps {
  formData: AgentFormData
  onFormChange: (data: AgentFormData) => void
  onCreateAgent: () => void
  isCreating?: boolean
  isUploading?: boolean
  userId?: string
  className?: string
  onClose?: () => void
}

export function AgentBuilderFormPreview({
  formData,
  onFormChange,
  onCreateAgent,
  isCreating = false,
  isUploading = false,
  userId,
  className,
  onClose
}: AgentBuilderFormPreviewProps) {
  const [animatedFields, setAnimatedFields] = useState<Set<string>>(new Set())

  // Animate fields when they get populated by AI
  useEffect(() => {
    const newFields = new Set<string>()
    if (formData.name) newFields.add('name')
    if (formData.instructions) newFields.add('instructions')
    if (formData.greetingText) newFields.add('greetingText')
    if (formData.tools?.length) newFields.add('tools')
    if (formData.mode) newFields.add('mode')
    if (formData.quickSuggestionsMode) newFields.add('quickSuggestions')
    if (formData.sourceUrls?.length) newFields.add('sourceUrls')

    setAnimatedFields(newFields)
  }, [formData])

  const isValid =
    formData.name &&
    formData.name.length >= 2 &&
    formData.instructions &&
    formData.instructions.length >= 10 &&
    formData.greetingText &&
    formData.greetingText.length > 0

  const toolOptions = Object.values(BUILTIN_AGENT_TOOLS)
  const quickSuggestionsMode = formData.quickSuggestionsMode ?? 'smart'
  const quickSuggestionsCount = formData.quickSuggestionsCount ?? 4

  return (
    <aside
      className={cn(
        'bg-beige-bg/50 flex h-full flex-col overflow-y-auto border-l border-black-10 p-6 dark:border-border dark:bg-background/50',
        className
      )}
    >
      <div className="mb-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <IconSparkles className="size-5 text-primary" />
            <h2 className="font-switzer text-lg font-semibold text-black-primary dark:text-foreground">
              Agent Builder
            </h2>
          </div>
        </div>
        <p className="mt-1 font-switzer text-sm text-gray-secondary">
          Live preview of your agent
        </p>
      </div>

      <div className="flex-1 space-y-4">
        {/* Name Field */}
        <Card
          className={cn(
            'transition-all duration-500',
            animatedFields.has('name') && 'ring-2 ring-primary/20'
          )}
        >
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              Name
              {formData.name && (
                <IconCheck className="size-4 text-green-600" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              value={formData.name || ''}
              onChange={e =>
                onFormChange({ ...formData, name: e.target.value })
              }
              placeholder="e.g., Support Assistant"
              className="font-switzer"
            />
            {formData.name && (
              <p className="mt-1 text-xs text-muted-foreground">
                {formData.name.length}/120 characters
              </p>
            )}
          </CardContent>
        </Card>

        {/* Instructions Field */}
        <Card
          className={cn(
            'transition-all duration-500',
            animatedFields.has('instructions') && 'ring-2 ring-primary/20'
          )}
        >
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              Instructions
              {formData.instructions && (
                <IconCheck className="size-4 text-green-600" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={formData.instructions || ''}
              onChange={e =>
                onFormChange({ ...formData, instructions: e.target.value })
              }
              placeholder="Describe how the agent should behave..."
              rows={6}
              className="font-switzer"
            />
            {formData.instructions && (
              <p className="mt-1 text-xs text-muted-foreground">
                {formData.instructions.length} characters
              </p>
            )}
          </CardContent>
        </Card>

        {/* Greeting Text Field */}
        <Card
          className={cn(
            'transition-all duration-500',
            animatedFields.has('greetingText') && 'ring-2 ring-primary/20'
          )}
        >
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              Greeting Message
              {formData.greetingText && (
                <IconCheck className="size-4 text-green-600" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={formData.greetingText || ''}
              onChange={e =>
                onFormChange({ ...formData, greetingText: e.target.value })
              }
              placeholder="e.g., Hi! How can I help you today?"
              rows={3}
              className="font-switzer"
            />
          </CardContent>
        </Card>

        {/* Tools Selection */}
        <Card
          className={cn(
            'transition-all duration-500',
            animatedFields.has('tools') && 'ring-2 ring-primary/20'
          )}
        >
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Tools</CardTitle>
            <CardDescription className="text-xs">
              AI-suggested tools for your agent
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {toolOptions.map(tool => {
                const isSelected = formData.tools?.includes(
                  tool.id as AgentToolType
                )
                return (
                  <Badge
                    key={tool.id}
                    variant={isSelected ? 'default' : 'secondary'}
                    className={cn(
                      'cursor-pointer transition-all',
                      isSelected && 'bg-primary text-primary-foreground'
                    )}
                    onClick={() => {
                      const currentTools = formData.tools || []
                      const newTools = isSelected
                        ? currentTools.filter(t => t !== tool.id)
                        : [...currentTools, tool.id as AgentToolType]
                      onFormChange({ ...formData, tools: newTools })
                    }}
                  >
                    {tool.name}
                  </Badge>
                )
              })}
            </div>

            {/* Source URLs — inline under tools */}
            <div
              className={cn(
                'rounded-md border bg-muted/50 p-3 transition-all duration-500',
                animatedFields.has('sourceUrls') && 'ring-2 ring-primary/20'
              )}
            >
              <p className="mb-1.5 flex items-center gap-2 text-xs font-medium">
                Source URLs
                {(formData.sourceUrls?.length ?? 0) > 0 && (
                  <IconCheck className="size-3.5 text-green-600" />
                )}
                <span className="font-normal text-muted-foreground">(pre-fetched into context, max 5)</span>
              </p>
              <div className="space-y-1.5">
                {(formData.sourceUrls ?? []).map((url, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 rounded border bg-card px-2 py-1.5"
                  >
                    <span className="flex-1 truncate text-xs">{url}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = (formData.sourceUrls ?? []).filter(
                          (_, i) => i !== idx
                        )
                        onFormChange({ ...formData, sourceUrls: next })
                      }}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <IconX className="size-3.5" />
                    </button>
                  </div>
                ))}
                {(formData.sourceUrls?.length ?? 0) < 5 && (
                  <form
                    onSubmit={e => {
                      e.preventDefault()
                      const input = e.currentTarget.elements.namedItem(
                        'newUrl'
                      ) as HTMLInputElement
                      const value = input?.value?.trim()
                      if (!value) return
                      try {
                        new URL(value)
                      } catch {
                        return
                      }
                      const current = formData.sourceUrls ?? []
                      if (current.includes(value) || current.length >= 5) return
                      onFormChange({
                        ...formData,
                        sourceUrls: [...current, value]
                      })
                      input.value = ''
                    }}
                    className="flex items-center gap-1.5"
                  >
                    <Input
                      name="newUrl"
                      placeholder="https://example.com"
                      className="h-8 flex-1 font-switzer text-xs"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2"
                    >
                      <IconPlus className="size-3.5" />
                    </Button>
                  </form>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Retrieval Strategy */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">
              File Retrieval Strategy
            </CardTitle>
            <CardDescription className="text-xs">
              How the agent reads uploaded files
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {RETRIEVAL_OPTIONS.map(opt => {
              const selected = (formData.retrievalStrategy ?? 'direct') === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    onFormChange({ ...formData, retrievalStrategy: opt.value })
                  }
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-md border p-2.5 text-left transition-colors',
                    selected
                      ? 'border-primary bg-primary/5'
                      : 'hover:border-muted-foreground/30 hover:bg-muted/40'
                  )}
                >
                  <div
                    className={cn(
                      'mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border',
                      selected ? 'border-primary' : 'border-muted-foreground/40'
                    )}
                  >
                    {selected && (
                      <div className="size-1.5 rounded-full bg-primary" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-medium">{opt.label}</span>
                    <p className="text-[10px] text-muted-foreground">
                      {opt.hint}
                    </p>
                  </div>
                </button>
              )
            })}
          </CardContent>
        </Card>

        {/* Agent Mode Selection */}
        <Card
          className={cn(
            'transition-all duration-500',
            animatedFields.has('mode') && 'ring-2 ring-primary/20'
          )}
        >
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Agent Mode</CardTitle>
            <CardDescription className="text-xs">
              Choose how your agent interacts with users
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Badge
                variant={
                  formData.mode !== 'collector' ? 'default' : 'secondary'
                }
                className={cn(
                  'flex-1 cursor-pointer justify-center py-2 transition-all',
                  formData.mode !== 'collector' &&
                    'bg-primary text-primary-foreground'
                )}
                onClick={() =>
                  onFormChange({
                    ...formData,
                    mode: 'provider',
                    maxMessages: null
                  })
                }
              >
                Info Provider
              </Badge>
              <Badge
                variant={
                  formData.mode === 'collector' ? 'default' : 'secondary'
                }
                className={cn(
                  'flex-1 cursor-pointer justify-center py-2 transition-all',
                  formData.mode === 'collector' &&
                    'bg-primary text-primary-foreground'
                )}
                onClick={() =>
                  onFormChange({
                    ...formData,
                    mode: 'collector',
                    maxMessages: 20
                  })
                }
              >
                Info Collector
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {formData.mode === 'collector'
                ? 'Agent will gather information from users (e.g., surveys, feedback)'
                : 'Agent will answer questions and provide information to users'}
            </p>
            {formData.mode === 'collector' && (
              <div className="pt-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Max messages before completion
                </label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={formData.maxMessages ?? 20}
                  onChange={e =>
                    onFormChange({
                      ...formData,
                      maxMessages: parseInt(e.target.value, 10) || 20
                    })
                  }
                  className="mt-1 font-switzer"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Suggestions */}
        <Card
          className={cn(
            'transition-all duration-500',
            animatedFields.has('quickSuggestions') && 'ring-2 ring-primary/20'
          )}
        >
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">
              Quick suggestions
            </CardTitle>
            <CardDescription className="text-xs">
              Show 3–4 suggestion chips to help users reply faster
            </CardDescription>
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
                    'bg-primary text-primary-foreground'
                )}
                onClick={() =>
                  onFormChange({
                    ...formData,
                    quickSuggestionsMode: 'off'
                  })
                }
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
                    'bg-primary text-primary-foreground'
                )}
                onClick={() =>
                  onFormChange({
                    ...formData,
                    quickSuggestionsMode: 'smart',
                    quickSuggestionsCount
                  })
                }
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
                    'bg-primary text-primary-foreground'
                )}
                onClick={() =>
                  onFormChange({
                    ...formData,
                    quickSuggestionsMode: 'always',
                    quickSuggestionsCount
                  })
                }
              >
                Always
              </Badge>
            </div>

            {quickSuggestionsMode !== 'off' && (
              <div className="flex items-center justify-between pt-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Suggestions count
                </label>
                <Select
                  value={String(quickSuggestionsCount)}
                  onValueChange={v =>
                    onFormChange({
                      ...formData,
                      quickSuggestionsCount: Number(v)
                    })
                  }
                >
                  <SelectTrigger className="h-8 w-16">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map(n => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {quickSuggestionsMode === 'off'
                ? 'No suggestions will be shown.'
                : quickSuggestionsMode === 'always'
                  ? `Show ${quickSuggestionsCount} suggestion chips after every reply.`
                  : `Show ${quickSuggestionsCount} suggestion chips when helpful.`}
            </p>
          </CardContent>
        </Card>

        {/* Allow Anonymous */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-switzer text-sm font-medium text-black-primary dark:text-foreground">
                  Allow anonymous chat
                </p>
                <p className="font-switzer text-xs text-gray-secondary">
                  Users can chat without signing in
                </p>
              </div>
              <Switch
                checked={formData.allowAnonymous ?? true}
                onCheckedChange={value =>
                  onFormChange({ ...formData, allowAnonymous: value })
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Files */}
        {formData.fileKeys && formData.fileKeys.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                Uploaded Files
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {formData.fileKeys.map(key => (
                  <li key={key} className="truncate">
                    📄 {key.split('/').pop()}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Create Agent Button */}
        <Card>
          <CardContent className="pt-6">
            <Button
              onClick={onCreateAgent}
              disabled={!isValid || isCreating}
              className="w-full rounded-full font-switzer"
              size="lg"
            >
              {isCreating ? 'Creating Agent...' : 'Create Agent'}
            </Button>
            {!isValid && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {!formData.name
                  ? 'Name is required'
                  : !formData.instructions
                    ? 'Instructions are required'
                    : !formData.greetingText
                      ? 'Greeting message is required'
                      : 'Complete all required fields'}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </aside>
  )
}
