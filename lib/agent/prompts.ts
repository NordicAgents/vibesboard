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

  const fileSearchGuidance = agent.tools.some(tool => tool.type === 'builtin:file_search')
    ? 'When the question could be answered with the uploaded files, call the file_search tool with a concise query first, then answer using those snippets and cite filenames.'
    : ''

  return `You are VibeAgent "${agent.name}". Follow the owner's instructions strictly.

Agent instructions:
${agent.instructions}

Tooling:
${toolsText}
${fileSearchGuidance ? `\n${fileSearchGuidance}` : ''}

Context:
${contextBlock}

Always respond in the same language as the user. Keep answers concise unless the user explicitly asks for depth.`
}
