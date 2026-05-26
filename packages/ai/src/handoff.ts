import 'server-only'

import { getAgentById } from '@vibesboard/agents/server'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import type { VibeAgent } from '@vibesboard/contracts'
import type { HandoffChainEntry } from '@vibesboard/contracts'
import type { Message } from '@vibesboard/contracts'

const MAX_HANDOFF_DEPTH = 5

export interface HandoffValidation {
  valid: boolean
  error?: string
  targetAgent?: VibeAgent
}

/**
 * Validate a handoff request:
 * - Feature flag enabled for tenant
 * - Target agent exists and is in same tenant
 * - Target agent is in source agent's handoffTargets whitelist
 * - No circular handoff (check chain)
 * - Max depth not exceeded
 */
export async function validateHandoff(params: {
  sourceAgent: VibeAgent
  targetAgentId: string
  handoffChain?: HandoffChainEntry[]
}): Promise<HandoffValidation> {
  const { sourceAgent, targetAgentId, handoffChain = [] } = params
  const tenantId = sourceAgent.tenantId

  if (!tenantId) {
    return { valid: false, error: 'Agent has no tenant' }
  }

  // 1. Feature flag check
  const enabled = await isFeatureEnabled(tenantId, 'AGENT_HANDOFF')
  if (!enabled) {
    return { valid: false, error: 'Agent handoff not enabled for tenant' }
  }

  // 2. Whitelist check
  if (!sourceAgent.handoffTargets?.includes(targetAgentId)) {
    return { valid: false, error: 'Target agent not in handoff targets' }
  }

  // 3. Load target agent
  const targetAgent = await getAgentById(targetAgentId)
  if (!targetAgent) {
    return { valid: false, error: 'Target agent not found' }
  }

  // 4. Same tenant check
  if (targetAgent.tenantId !== tenantId) {
    return { valid: false, error: 'Target agent is in different tenant' }
  }

  // 5. Max depth check
  if (handoffChain.length >= MAX_HANDOFF_DEPTH) {
    return { valid: false, error: 'Maximum handoff depth reached' }
  }

  // 6. Circular handoff prevention
  const wouldBeCircular = handoffChain.some(
    h => h.toAgentId === targetAgentId || h.fromAgentId === targetAgentId
  )
  if (wouldBeCircular) {
    return { valid: false, error: 'Circular handoff detected' }
  }

  return { valid: true, targetAgent }
}

/**
 * Build a context summary for the target agent from the prior conversation.
 * Includes the last N messages so the target agent has context.
 */
export function buildHandoffContext(params: {
  sourceAgentName: string
  messages: Message[]
  summary?: string | null
  maxMessages?: number
}): string {
  const { sourceAgentName, messages, summary, maxMessages = 10 } = params

  const recentMessages = messages.slice(-maxMessages)
  const formatted = recentMessages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`)
    .join('\n')

  const parts = [
    `This conversation was transferred to you from "${sourceAgentName}".`,
    summary ? `Summary of prior conversation: ${summary}` : null,
    `Recent conversation:\n${formatted}`,
    'Continue helping the user from where the previous agent left off. Do not repeat the greeting.'
  ].filter(Boolean)

  return parts.join('\n\n')
}

export { MAX_HANDOFF_DEPTH }
