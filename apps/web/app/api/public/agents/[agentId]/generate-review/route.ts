import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getAgentById } from '@vibesboard/agents/server'
import { completeText } from '@vibesboard/adapter-openai'

export const runtime = 'nodejs'

const requestSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string()
    })
  )
})

function buildReviewPrompt(
  messages: { role: string; content: string }[]
): string {
  const conversation = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `${m.role === 'user' ? 'Customer' : 'Agent'}: ${m.content}`)
    .join('\n\n')

  return (
    `You are a helpful assistant that writes Google reviews based on customer conversations.\n\n` +
    `Below is a conversation between a customer and a business agent. Based ONLY on the customer's messages and sentiment, write a Google review from the customer's perspective.\n\n` +
    `Rules:\n` +
    `- Write in first person as if you are the customer\n` +
    `- Keep it 2-4 sentences, natural and authentic\n` +
    `- Capture specific details the customer mentioned (products, services, experience)\n` +
    `- Match the overall sentiment (positive, neutral, mixed) from the customer's messages\n` +
    `- Write in the same language the customer used\n` +
    `- Do NOT invent details not mentioned in the conversation\n` +
    `- Do NOT include star ratings or emojis\n` +
    `- Output ONLY the review text, nothing else\n\n` +
    `Conversation:\n${conversation}\n\n` +
    `Write the review:`
  )
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params
  const agent = await getAgentById(agentId)

  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  if (!agent.allowAnonymous) {
    return NextResponse.json(
      { error: 'Agent does not allow anonymous access' },
      { status: 403 }
    )
  }

  try {
    const body = await req.json()
    const { messages } = requestSchema.parse(body)

    const userMessages = messages.filter(
      m => m.role === 'user' && m.content.trim().length > 0
    )

    if (userMessages.length === 0) {
      return NextResponse.json(
        { error: 'No conversation content to generate review from' },
        { status: 400 }
      )
    }

    const prompt = buildReviewPrompt(messages)
    const review = await completeText({ prompt })

    return NextResponse.json({ review: review.text.trim() })
  } catch (error) {
    console.error('[generate-review] Failed:', error)
    return NextResponse.json(
      { error: 'Failed to generate review' },
      { status: 500 }
    )
  }
}
