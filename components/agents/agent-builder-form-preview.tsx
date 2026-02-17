'use client'

import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
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
import { IconSparkles, IconCheck, IconX } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import { type AgentToolType, type AgentMode } from '@/lib/types'
import { BUILTIN_AGENT_TOOLS } from '@/lib/agents/db'

export interface AgentFormData {
  name?: string
  instructions?: string
  greetingText?: string
  allowAnonymous?: boolean
  tools?: AgentToolType[]
  fileKeys?: string[]
  mode?: AgentMode
  maxMessages?: number | null
  quickSuggestionsMode?: 'off' | 'smart' | 'always'
  quickSuggestionsCount?: 3 | 4
}

interface AgentBuilderFormPreviewProps {
  formData: AgentFormData
  onFormChange: (data: AgentFormData) => void
  onCreateAgent: () => void
  onFileUpload?: (files: FileList | null) => void
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
  onFileUpload,
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
        'flex h-full flex-col overflow-y-auto border-l border-black-10 bg-beige-bg/50 p-6 dark:bg-background/50 dark:border-border',
        className
      )}
    >
      <div className="mb-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <IconSparkles className="h-5 w-5 text-primary" />
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
                <IconCheck className="h-4 w-4 text-green-600" />
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
                <IconCheck className="h-4 w-4 text-green-600" />
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
                <IconCheck className="h-4 w-4 text-green-600" />
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
          <CardContent>
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
                  'cursor-pointer transition-all flex-1 justify-center py-2',
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
                  'cursor-pointer transition-all flex-1 justify-center py-2',
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
                  'cursor-pointer transition-all flex-1 justify-center py-2',
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
                  'cursor-pointer transition-all flex-1 justify-center py-2',
                  quickSuggestionsMode === 'smart' &&
                    'bg-primary text-primary-foreground'
                )}
                onClick={() =>
                  onFormChange({
                    ...formData,
                    quickSuggestionsMode: 'smart',
                    quickSuggestionsCount: quickSuggestionsCount === 3 ? 3 : 4
                  })
                }
              >
                Smart (Wisely)
              </Badge>
              <Badge
                variant={
                  quickSuggestionsMode === 'always' ? 'default' : 'secondary'
                }
                className={cn(
                  'cursor-pointer transition-all flex-1 justify-center py-2',
                  quickSuggestionsMode === 'always' &&
                    'bg-primary text-primary-foreground'
                )}
                onClick={() =>
                  onFormChange({
                    ...formData,
                    quickSuggestionsMode: 'always',
                    quickSuggestionsCount: quickSuggestionsCount === 3 ? 3 : 4
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
                <div className="flex gap-2">
                  <Badge
                    variant={
                      quickSuggestionsCount === 3 ? 'default' : 'secondary'
                    }
                    className={cn(
                      'cursor-pointer transition-all px-4 py-1',
                      quickSuggestionsCount === 3 &&
                        'bg-primary text-primary-foreground'
                    )}
                    onClick={() =>
                      onFormChange({
                        ...formData,
                        quickSuggestionsCount: 3
                      })
                    }
                  >
                    3
                  </Badge>
                  <Badge
                    variant={
                      quickSuggestionsCount === 4 ? 'default' : 'secondary'
                    }
                    className={cn(
                      'cursor-pointer transition-all px-4 py-1',
                      quickSuggestionsCount === 4 &&
                        'bg-primary text-primary-foreground'
                    )}
                    onClick={() =>
                      onFormChange({
                        ...formData,
                        quickSuggestionsCount: 4
                      })
                    }
                  >
                    4
                  </Badge>
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {quickSuggestionsMode === 'off'
                ? 'No suggestions will be shown.'
                : quickSuggestionsMode === 'always'
                  ? 'Suggestions appear after every agent reply.'
                  : 'Suggestions appear when helpful (start + questions).'}
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

        {/* File Upload */}
        {onFileUpload && userId && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Add Files</CardTitle>
              <CardDescription className="text-xs">
                Upload documents to ground your agent's knowledge
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  document.getElementById('form-file-upload')?.click()
                }
                disabled={isUploading}
                className="w-full"
              >
                {isUploading ? 'Uploading...' : 'Choose Files'}
              </Button>
              <input
                id="form-file-upload"
                type="file"
                multiple
                className="hidden"
                onChange={e => onFileUpload(e.target.files)}
              />
              {/* Create Agent Button */}
              <Button
                onClick={onCreateAgent}
                disabled={!isValid || isCreating}
                className="w-full rounded-full font-switzer"
                size="lg"
              >
                {isCreating ? 'Creating Agent...' : 'Create Agent'}
              </Button>
              {!isValid && (
                <p className="text-center text-xs text-muted-foreground">
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
        )}

        {/* Create Agent Button - shown when file upload is not available */}
        {(!onFileUpload || !userId) && (
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
        )}
      </div>
    </aside>
  )
}
