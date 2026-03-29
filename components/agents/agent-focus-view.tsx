'use client'

import { useState } from 'react'
import type { VibeAgent, AgentSharePayload } from '@/lib/types'
import { useAgentForm } from '@/lib/hooks/use-agent-form'
import { FocusForm } from '@/components/agents/focus-form'
import { FocusPreview } from '@/components/agents/focus-preview'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Eye } from 'lucide-react'

interface AgentFocusViewProps {
  agent: VibeAgent
  share: AgentSharePayload
  canEdit: boolean
  onSwitchToAdvanced: () => void
  onSwitchToChat: () => void
}

export function AgentFocusView({
  agent,
  share,
  canEdit,
  onSwitchToAdvanced,
  onSwitchToChat
}: AgentFocusViewProps) {
  const form = useAgentForm(agent)
  const [previewOpen, setPreviewOpen] = useState(false)

  const handleSwitchToAdvanced = () => {
    if (form.hasChanges) {
      const proceed = window.confirm(
        'You have unsaved changes. They will be lost if you switch views. Continue?'
      )
      if (!proceed) return
    }
    onSwitchToAdvanced()
  }

  return (
    <div className="flex h-full">
      {/* Left: Form */}
      <div className="flex-1 overflow-y-auto p-6 lg:max-w-[580px]">
        <div className="mb-4">
          <p className="text-xs uppercase text-[#6f7f80]">Agent</p>
          <h2 className="font-sans text-lg font-semibold text-[#222f30] dark:text-[#f5f8f7]">
            {agent.name}
          </h2>
        </div>
        <FocusForm
          agent={agent}
          share={share}
          form={form}
          onSwitchToAdvanced={handleSwitchToAdvanced}
          onSwitchToChat={onSwitchToChat}
        />
      </div>

      {/* Right: Preview (desktop only) */}
      <div className="hidden flex-1 items-center justify-center border-l border-[#e4e3e3] bg-[#f5f8f7] dark:border-[#344348] dark:bg-[#192425] lg:flex">
        <FocusPreview
          agentName={form.fields.name}
          greetingText={form.fields.greetingText}
          quickSuggestionsMode={form.fields.quickSuggestionsMode}
        />
      </div>

      {/* Mobile: Floating preview button */}
      <div className="fixed bottom-20 right-4 lg:hidden">
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogTrigger asChild>
            <Button
              size="sm"
              variant="secondary"
              className="gap-2 rounded-full shadow-md"
            >
              <Eye className="size-4" />
              Preview
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[380px]">
            <DialogHeader className="pb-2">
              <DialogTitle className="text-sm">Visitor Preview</DialogTitle>
            </DialogHeader>
            <div className="flex items-center justify-center overflow-y-auto py-4">
              <FocusPreview
                agentName={form.fields.name}
                greetingText={form.fields.greetingText}
                quickSuggestionsMode={form.fields.quickSuggestionsMode}
              />
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
