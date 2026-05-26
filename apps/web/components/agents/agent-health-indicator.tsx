'use client'

import type { VibeAgent } from '@vibesboard/contracts'
import type { AgentFormFields } from '@/lib/hooks/use-agent-form'
import { Settings } from 'lucide-react'

interface HealthCheck {
  label: string
  passed: boolean
  hint?: string
}

const DEFAULT_NAME_PATTERN = /^(New Agent|My Agent|Untitled)/i
const DEFAULT_GREETING = 'Hi How can i help you today'

function computeHealthChecks(
  agent: VibeAgent,
  fields: AgentFormFields
): HealthCheck[] {
  return [
    {
      label: 'Name set',
      passed: !!fields.name && !DEFAULT_NAME_PATTERN.test(fields.name),
      hint: 'Give your agent a descriptive name'
    },
    {
      label: 'Instructions written',
      passed: fields.instructions.length > 50,
      hint: 'Write at least 50 characters of instructions'
    },
    {
      label: 'First message customized',
      passed:
        !!fields.greetingText &&
        fields.greetingText.trim() !== DEFAULT_GREETING &&
        fields.greetingText.trim().length > 5,
      hint: 'Customize the greeting visitors see first'
    },
    {
      label: 'Knowledge files added',
      passed: agent.fileKeys.length > 0 || (agent.sourceUrls?.length ?? 0) > 0,
      hint: 'Upload files or add URLs in Advanced Settings'
    },
    {
      label: 'Notifications configured',
      passed: !!(agent.notificationConfig as any)?.enabled,
      hint: 'Set up alerts in Advanced Settings'
    }
  ]
}

interface AgentHealthIndicatorProps {
  agent: VibeAgent
  fields: AgentFormFields
  onAdvancedClick?: () => void
}

export function AgentHealthIndicator({
  agent,
  fields,
  onAdvancedClick
}: AgentHealthIndicatorProps) {
  const checks = computeHealthChecks(agent, fields)
  const passed = checks.filter(c => c.passed).length
  const total = checks.length

  const getMessage = () => {
    if (passed === total) return 'Your agent is fully configured!'
    if (passed >= 3) return 'Your agent is ready to chat!'
    return 'Complete setup to get started'
  }

  return (
    <div className="rounded-2xl border border-[#e4e3e3] bg-[#f5f8f7] p-4 dark:border-[#344348] dark:bg-[#192425]">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5">
            {checks.map((check, i) => (
              <div
                key={i}
                className={`size-2 rounded-full ${
                  check.passed
                    ? 'bg-emerald-500'
                    : 'bg-[#e4e3e3] dark:bg-[#344348]'
                }`}
              />
            ))}
          </div>
          <span className="text-xs font-medium text-[#222f30] dark:text-[#f5f8f7]">
            {passed}/{total}
          </span>
        </div>
        <span className="text-xs text-[#6f7f80]">{getMessage()}</span>
      </div>
      <div className="space-y-1.5">
        {checks.map((check, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span
              className={
                check.passed
                  ? 'text-emerald-500'
                  : 'text-[#9d9790] dark:text-[#6f7f80]'
              }
            >
              {check.passed ? '\u2713' : '\u25CB'}
            </span>
            <span
              className={
                check.passed
                  ? 'text-[#445e5f] dark:text-[#c9cbbe]'
                  : 'text-[#9d9790] dark:text-[#6f7f80]'
              }
            >
              {check.label}
            </span>
            {!check.passed && check.hint && i >= 3 && onAdvancedClick && (
              <button
                onClick={onAdvancedClick}
                className="ml-auto flex items-center gap-1 text-[10px] text-[#6f7f80] transition-colors hover:text-[#222f30] dark:hover:text-[#f5f8f7]"
              >
                <Settings className="size-2.5" />
                Advanced
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
