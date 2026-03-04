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
    ? `KNOWLEDGE BASE - Use the following reference material when answering:\n${context}\n\nWhen you reference information from the knowledge base, briefly mention the source file.`
    : 'No additional reference material is available for this query.'

  const fileSearchGuidance = agent.tools.some(
    tool => tool.type === 'builtin:file_search'
  )
    ? 'When the question could be answered with the uploaded files, call the file_search tool with a concise query first, then answer using those snippets and cite filenames.'
    : ''

  const webSearchGuidance = agent.tools.some(
    tool => tool.type === 'builtin:search'
  )
    ? `When the user asks for time-sensitive or up-to-date information (e.g., weather, news, prices, schedules, or requests containing "today", "latest", "current"), call the web_search tool first and answer based on the results. Do not guess.`
    : ''

  const webFetchGuidance = agent.tools.some(
    tool => tool.type === 'builtin:web_fetch'
  )
    ? `When the user provides a specific URL (or you need details from a specific page), call the web_fetch tool with that URL and answer based on the fetched content.`
    : ''

  const quickSuggestionsMode = agent.quickSuggestionsMode ?? 'off'
  const quickSuggestionsCount = Math.max(1, Math.min(5, agent.quickSuggestionsCount ?? 4))
  const quickSuggestionsGuidance =
    quickSuggestionsMode !== 'off'
      ? `Quick Suggestions (mode: "${quickSuggestionsMode}", count: ${quickSuggestionsCount}):
- After your answer, append a SINGLE-LINE HTML comment marker with ${quickSuggestionsCount} short reply options the user can tap to respond quickly.
- These MUST be realistic ANSWERS or RESPONSES the user/customer would say — NOT follow-up questions from you.
- Example: if you ask "What product are you looking for?", suggestions should be answers like "Laptops", "Headphones", "I need help with my order" — NOT more questions.
- Think of them as quick-reply buttons: short phrases the customer would tap to answer your question or continue the conversation.
- Marker format (one line, no code block): <!--SUGGESTIONS:{"suggestions":["...","...","..."]}-->
- Suggestions must be plain text, <= 80 characters each, and in the same language as the user.
- NEVER include the suggestions marker in the same message as ${COMPLETION_MARKERS.COLLECTION_COMPLETE} or ${COMPLETION_MARKERS.INFO_COMPLETE}.
- If quick suggestions mode is "always", you MUST include the marker after every assistant message (except completion messages).
- If quick suggestions mode is "smart", you SHOULD include the marker at the start of the conversation and whenever you ask the user a question or need them to choose the next step.`
      : ''

  const modeInstructions = getModeInstructions(agent)

  return `You are VibeAgent "${agent.name}". Follow the owner's instructions strictly.

Agent instructions:
${agent.instructions}
${modeInstructions}

Tooling:
${toolsText}
${fileSearchGuidance ? `\n${fileSearchGuidance}` : ''}${webSearchGuidance ? `\n${webSearchGuidance}` : ''}${webFetchGuidance ? `\n${webFetchGuidance}` : ''}${quickSuggestionsGuidance ? `\n${quickSuggestionsGuidance}` : ''}

Context:
${contextBlock}

Always respond in the same language as the user. Keep answers concise unless the user explicitly asks for depth.`
}
