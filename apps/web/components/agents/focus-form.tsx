'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { VibeAgent, AgentSharePayload } from '@vibesboard/contracts'
import type { UseAgentFormReturn } from '@/lib/hooks/use-agent-form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { QrCode } from '@/components/qr-code'
import { IconExternalLink } from '@/components/ui/icons'
import { AgentHealthIndicator } from '@/components/agents/agent-health-indicator'
import { AgentTemplateCards } from '@/components/agents/agent-template-cards'
import { getTemplateDefaults } from '@vibesboard/agents/focus-templates'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { Settings2, HelpCircle } from 'lucide-react'

interface FocusFormProps {
  agent: VibeAgent
  share: AgentSharePayload
  form: UseAgentFormReturn
  onSwitchToAdvanced: () => void
}

export function FocusForm({
  agent,
  share,
  form,
  onSwitchToAdvanced
}: FocusFormProps) {
  const { fields, setters, hasChanges, saving, handleSaveAll } = form
  const [copied, setCopied] = useState(false)

  const showTemplates = !fields.instructions || fields.instructions.length < 20

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(share.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // noop
    }
  }

  const handleApplyTemplate = (
    defaults: ReturnType<typeof getTemplateDefaults>
  ) => {
    if (!defaults) return
    form.applyTemplate({
      instructions: defaults.instructions,
      greetingText: defaults.greetingText,
      mode: defaults.mode,
      quickSuggestionsMode: defaults.quickSuggestionsMode,
      collectionFields: defaults.collectionFields
    })
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-5">
        {/* Health Indicator */}
        <AgentHealthIndicator
          agent={agent}
          fields={fields}
          onAdvancedClick={onSwitchToAdvanced}
        />

        {/* Template Cards */}
        {showTemplates && <AgentTemplateCards onApply={handleApplyTemplate} />}

        {/* Agent Name */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-[#445e5f] dark:text-[#c9cbbe]">
            Agent name
          </Label>
          <Input
            value={fields.name}
            onChange={e => setters.setName(e.target.value)}
            placeholder="e.g. Support Bot"
            disabled={saving}
          />
        </div>

        {/* Instructions */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs font-medium text-[#445e5f] dark:text-[#c9cbbe]">
              Instructions
            </Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="size-3.5 cursor-help text-[#9d9790]" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[220px]">
                Define your agent&apos;s personality, knowledge scope, and
                conversation boundaries.
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-[11px] text-[#9d9790]">
            Tell your agent how to behave &mdash; its personality, what it knows
            about, and what it should never discuss.
          </p>
          <Textarea
            value={fields.instructions}
            onChange={e => setters.setInstructions(e.target.value)}
            placeholder="You are a helpful agent that..."
            rows={6}
            disabled={saving}
          />
        </div>

        {/* First Message */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs font-medium text-[#445e5f] dark:text-[#c9cbbe]">
              First message
            </Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="size-3.5 cursor-help text-[#9d9790]" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[220px]">
                The greeting visitors see when they open a chat. Make it
                welcoming and set expectations.
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-[11px] text-[#9d9790]">
            The first thing visitors see when they open a chat.
          </p>
          <Textarea
            value={fields.greetingText}
            onChange={e => setters.setGreetingText(e.target.value)}
            placeholder="Hi! How can I help you today?"
            rows={3}
            disabled={saving}
          />
        </div>

        {/* Suggested Replies */}
        <div className="flex items-center justify-between rounded-xl border border-[#e4e3e3] bg-card px-4 py-3 dark:border-[#344348]">
          <div>
            <div className="flex items-center gap-1.5">
              <Label className="text-sm font-medium text-[#222f30] dark:text-[#f5f8f7]">
                Suggested replies
              </Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="size-3.5 cursor-help text-[#9d9790]" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px]">
                  AI-generated clickable suggestions appear after each agent
                  response to guide conversation.
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="text-[11px] text-[#9d9790]">
              Show clickable suggestions to guide the conversation
            </p>
          </div>
          <Switch
            checked={fields.quickSuggestionsMode !== 'off'}
            onCheckedChange={checked =>
              setters.setQuickSuggestionsMode(checked ? 'smart' : 'off')
            }
            disabled={saving}
          />
        </div>

        {/* Share Link */}
        {share.url && (
          <Card>
            <CardContent className="space-y-3 p-4">
              <Label className="text-xs font-medium text-[#445e5f] dark:text-[#c9cbbe]">
                Share link
              </Label>
              <div className="flex items-center gap-2 rounded-lg border border-[#e4e3e3] p-2 dark:border-[#344348]">
                <span className="flex-1 truncate text-xs text-[#445e5f] dark:text-[#c9cbbe]">
                  {share.url}
                </span>
                <Button size="sm" variant="secondary" onClick={handleCopy}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <Link
                    href={share.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <IconExternalLink className="size-4" />
                  </Link>
                </Button>
              </div>
              <div className="flex items-center justify-center">
                <QrCode dataUrl={share.qrDataUrl} size={160} />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={onSwitchToAdvanced}
            className="flex items-center gap-1.5 text-xs text-[#6f7f80] transition-colors hover:text-[#222f30] dark:hover:text-[#f5f8f7]"
          >
            <Settings2 className="size-3.5" />
            Advanced Settings
          </button>
        </div>

        {/* Save Button */}
        <div className="sticky bottom-0 border-t border-[#e4e3e3] bg-[#f7f7f5]/95 pb-4 pt-3 backdrop-blur dark:border-[#344348] dark:bg-[#222f30]/95">
          <Button
            onClick={handleSaveAll}
            disabled={saving || !hasChanges}
            className="w-full rounded-full"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  )
}
