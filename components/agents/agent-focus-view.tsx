'use client'

import type { VibeAgent, AgentSharePayload } from '@/lib/types'
import { useAgentForm } from '@/lib/hooks/use-agent-form'
import { FocusForm } from '@/components/agents/focus-form'

interface AgentFocusViewProps {
  agent: VibeAgent
  share: AgentSharePayload
  canEdit: boolean
  onSwitchToAdvanced: () => void
}

export function AgentFocusView({
  agent,
  share,
  canEdit,
  onSwitchToAdvanced
}: AgentFocusViewProps) {
  const form = useAgentForm(agent)

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
      <div className="flex-1 overflow-y-auto p-6">
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
        />
      </div>
    </div>
  )
}
