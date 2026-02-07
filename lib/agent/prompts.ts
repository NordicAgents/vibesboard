import { type VibeAgent } from '@/lib/types'

// Completion signal markers - used by API to detect when chat should complete
export const COMPLETION_MARKERS = {
  COLLECTION_COMPLETE: '[COLLECTION_COMPLETE]',
  INFO_COMPLETE: '[INFO_COMPLETE]'
} as const

function getModeInstructions(agent: VibeAgent): string {
  if (agent.mode === 'collector') {
    return `
IMPORTANT - Information Collection Mode:
Your primary goal is to gather specific information from the user efficiently.
- Ask clear, focused questions to collect the required data
- Keep the conversation concise and on-topic
- Once you have gathered all the information you need, end your response with exactly: ${COMPLETION_MARKERS.COLLECTION_COMPLETE}
- This marker signals that the data collection is complete
- Do not include this marker until you have collected all necessary information`
  }

  // Provider mode (default)
  return `
IMPORTANT - Information Providing Mode:
Your primary goal is to provide helpful information to the user.
- Answer questions thoroughly but concisely
- After providing substantive information, occasionally ask: "Is there anything else you'd like to know?"
- If the user indicates they are done (e.g., "no", "thanks", "that's all", "I'm good"), end your response with exactly: ${COMPLETION_MARKERS.INFO_COMPLETE}
- This marker signals that the user has received the information they need`
}

export function buildAgentSystemPrompt(
  agent: VibeAgent,
  context?: string | null
) {
  const toolsText = agent.tools.length
    ? agent.tools
        .map(tool => `- ${tool.name}: ${tool.description ?? 'Custom tool'}`)
        .join('\n')
    : 'No external tools are enabled for this agent.'

  const contextBlock = context
    ? `Use the following reference material when it is relevant:\n${context}`
    : 'There is no reference material attached to this request.'

  const fileSearchGuidance = agent.tools.some(
    tool => tool.type === 'builtin:file_search'
  )
    ? 'When the question could be answered with the uploaded files, call the file_search tool with a concise query first, then answer using those snippets and cite filenames.'
    : ''

  const modeInstructions = getModeInstructions(agent)

  return `You are VibeAgent "${agent.name}". Follow the owner's instructions strictly.

Agent instructions:
${agent.instructions}
${modeInstructions}

Tooling:
${toolsText}
${fileSearchGuidance ? `\n${fileSearchGuidance}` : ''}

Context:
${contextBlock}

Always respond in the same language as the user. Keep answers concise unless the user explicitly asks for depth.`
}
