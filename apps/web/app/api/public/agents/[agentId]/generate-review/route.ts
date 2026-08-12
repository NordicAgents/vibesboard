import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getAgentById } from '@vibesboard/agents/server'
import { completeText, OPENAI_CHAT_MODEL } from '@vibesboard/adapter-openai'
import { ensureExternalSessionId } from '@/lib/agent-cookies'
import {
  consumeRateLimit,
  getRateLimitSalt,
  getTrustedClientAddress,
  type RateLimitResult
} from '@vibesboard/policy/rate-limit'
import { checkUsageLimit, recordUsage, usageLimitResponse } from '@/lib/usage'
import {
  incrementAgentResponseCount,
  reserveAgentResponseSlot
} from '@vibesboard/agents/limits'

export const runtime = 'nodejs'

const requestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string().max(2_000)
      })
    )
    .max(100)
})

function positiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function rateLimitResponse(result: RateLimitResult) {
  const retryAfter = Math.max(
    1,
    Math.ceil((result.resetAt.getTime() - Date.now()) / 1_000)
  )
  return NextResponse.json(
    {
      error: 'rate_limit_reached',
      message: 'Too many review requests. Please try again shortly.'
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'Cache-Control': 'no-store'
      }
    }
  )
}

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
    const externalId = await ensureExternalSessionId()

    const salt = getRateLimitSalt()
    const windowMs = positiveIntegerEnv(
      'PUBLIC_REVIEW_RATE_LIMIT_WINDOW_MS',
      60_000
    )
    const clientAddress = getTrustedClientAddress(req.headers)
    const checks = [
      consumeRateLimit({
        scope: `public-review-session:${agent.id}`,
        identifier: externalId,
        salt,
        limit: positiveIntegerEnv('PUBLIC_REVIEW_SESSION_RATE_LIMIT', 6),
        windowMs
      }),
      consumeRateLimit({
        scope: 'public-review-agent',
        identifier: agent.id,
        salt,
        limit: positiveIntegerEnv('PUBLIC_REVIEW_AGENT_RATE_LIMIT', 60),
        windowMs
      })
    ]
    if (clientAddress) {
      checks.push(
        consumeRateLimit({
          scope: `public-review-address:${agent.id}`,
          identifier: clientAddress,
          salt,
          limit: positiveIntegerEnv('PUBLIC_REVIEW_ADDRESS_RATE_LIMIT', 15),
          windowMs
        })
      )
    }
    const rejected = (await Promise.all(checks)).find(result => !result.allowed)
    if (rejected) return rateLimitResponse(rejected)

    const usageCheck = await checkUsageLimit(agent.tenantId!)
    if (!usageCheck.allowed) return usageLimitResponse(usageCheck)

    const hasLifetimeResponseCap = agent.maxAgentResponses != null
    if (hasLifetimeResponseCap) {
      const slotReserved = await reserveAgentResponseSlot(
        agent.tenantId!,
        agent.id,
        agent.maxAgentResponses!
      )
      if (!slotReserved) {
        return NextResponse.json(
          { error: 'Agent response limit reached', code: 'AGENT_LIMIT_REACHED' },
          { status: 403 }
        )
      }
    }

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

    if (!hasLifetimeResponseCap) {
      await incrementAgentResponseCount(agent.tenantId!, agent.id)
    }
    await recordUsage({
      tenantId: agent.tenantId!,
      agentId: agent.id,
      conversationId: null,
      userId: null,
      externalId,
      source: 'public_chat',
      model: OPENAI_CHAT_MODEL,
      inputTokens: review.usage?.inputTokens,
      outputTokens: review.usage?.outputTokens
    })

    return NextResponse.json({ review: review.text.trim() })
  } catch (error) {
    console.error('[generate-review] Failed:', error)
    return NextResponse.json(
      { error: 'Failed to generate review' },
      { status: 500 }
    )
  }
}
