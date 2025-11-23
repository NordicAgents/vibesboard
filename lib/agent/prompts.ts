import { type VibeAgent } from '@/lib/types'

export function buildAgentSystemPrompt(agent: VibeAgent, context?: string | null) {
  const toolsText = agent.tools.length
    ? agent.tools
        .map(tool => `- ${tool.name}: ${tool.description ?? 'Custom tool'}`)
        .join('\n')
    : 'No external tools are enabled for this agent.'

  const contextBlock = context
    ? `Use the following reference material when it is relevant:\n${context}`
    : 'There is no reference material attached to this request.'

  return `You are VibeAgent "${agent.name}". Follow the owner's instructions strictly.

Agent instructions:
${agent.instructions}

Tooling:
${toolsText}

Context:
${contextBlock}

Always respond in the same language as the user. Keep answers concise unless the user explicitly asks for depth.`
}
