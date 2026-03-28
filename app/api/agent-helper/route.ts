import { createOpenAI } from '@ai-sdk/openai'
import { streamText as aiStreamText } from 'ai'

import { auth } from '@/auth'
import { OPENAI_CHAT_MODEL, isResponsesModel, streamText } from '@/lib/openai'

export const runtime = 'nodejs'


export async function POST(req: Request) {
  const session = await auth()

  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const json = await req.json()
  const { messages, previewToken } = json

  const model = OPENAI_CHAT_MODEL
  const apiKey = previewToken ?? process.env.OPENAI_API_KEY ?? null

  const systemPrompt = `You are an expert AI agent designer specializing in creating VibeAgents. Your role is to help users craft comprehensive, effective agent instructions.

When a user describes their agent idea, transform it into well-structured instructions that include:

1. **Role & Identity**: Define who the agent is (e.g., "You are a customer support specialist for a fitness app")

2. **Personality & Tone**: Specify how the agent should communicate:
   - Friendly and casual vs. professional and formal
   - Empathetic, enthusiastic, direct, or playful
   - Use of emojis, humor, or specific phrases

3. **Core Responsibilities**: List the main tasks and objectives:
   - What questions should they answer?
   - What problems should they solve?
   - What actions can they help with?

4. **Conversation Flow**:
   - How should the agent greet users?
   - How should they ask clarifying questions?
   - How should they close conversations?

5. **Guardrails & Boundaries**: Define what the agent should NOT do:
   - Topics to avoid
   - When to escalate to humans
   - Privacy and data handling rules

6. **Knowledge & Context**: Specify any domain knowledge:
   - Reference specific data sources or files
   - Mention key facts, policies, or procedures
   - Include relevant background information

7. **Example Interactions** (optional): Show sample exchanges to illustrate the desired behavior

Format your output as clear, actionable instructions written in second person ("You are...", "You should..."). Keep it concise but comprehensive. Focus on specificity over generalities.

Example output format:
"You are [role]. Your personality is [traits]. When users ask about [topic], you should [action]. Always maintain a [tone] while ensuring [guardrails]. Use [knowledge sources] to provide accurate information. Never [boundaries]."

Remember: Great agent instructions are specific, actionable, and provide clear boundaries while giving the agent personality and purpose.`

  if (isResponsesModel(model)) {
    const history = Array.isArray(messages)
      ? messages
          .map(
            (m: any) =>
              `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${
                typeof m.content === 'string' ? m.content : ''
              }`
          )
          .join('\n\n')
      : ''

    const prompt = `${systemPrompt}\n\n${
      history ? `Conversation so far:\n${history}` : ''
    }`

    const stream = await streamText({ prompt, model, apiKey })
    return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }

  const openaiClient = createOpenAI({ apiKey })
  const result = await aiStreamText({
    model: openaiClient(model),
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    temperature: 0.3
  })
  return result.toTextStreamResponse()
}
