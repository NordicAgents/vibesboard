'use client'

import {
  AGENT_TEMPLATES,
  getTemplateDefaults
} from '@vibesboard/agents/focus-templates'
import { Headphones, UserPlus, HelpCircle, CalendarDays } from 'lucide-react'

const ICON_MAP = {
  Headphones,
  UserPlus,
  HelpCircle,
  CalendarDays
} as const

interface AgentTemplateCardsProps {
  onApply: (defaults: ReturnType<typeof getTemplateDefaults>) => void
}

export function AgentTemplateCards({ onApply }: AgentTemplateCardsProps) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-[#6f7f80]">
        Start from a template
      </p>
      <div className="grid grid-cols-2 gap-2">
        {AGENT_TEMPLATES.map(template => {
          const Icon = ICON_MAP[template.icon]
          return (
            <button
              key={template.id}
              onClick={() => {
                const defaults = getTemplateDefaults(template.id)
                if (defaults) onApply(defaults)
              }}
              className="flex items-start gap-3 rounded-xl border border-[#e4e3e3] bg-card p-3 text-left transition-all hover:border-[#c9cbbe] hover:shadow-sm active:scale-[0.98] dark:border-[#344348] dark:hover:border-[#445e5f]"
            >
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#e6ede6] text-[#445e5f] dark:bg-[#344348] dark:text-[#c9cbbe]">
                <Icon className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#222f30] dark:text-[#f5f8f7]">
                  {template.name}
                </p>
                <p className="text-xs text-[#6f7f80]">{template.description}</p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
