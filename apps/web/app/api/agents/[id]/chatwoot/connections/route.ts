import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAuth } from '@/lib/auth/route-handler'
import { getCanonicalOrigin } from '@/lib/app-url'
import { getAgentById } from '@vibesboard/agents/server'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import {
  validateChatwootCredentials,
  listChatwootInboxes,
  createChatwootWebhook,
  createChatwootAgentBot,
  assignAgentBotToInbox,
  deleteChatwootWebhook,
  deleteChatwootAgentBot
} from '@vibesboard/channel-chatwoot/api-client'
import {
  createChatwootConnection,
  listChatwootConnections,
  generateConnectionId
} from '@vibesboard/channel-chatwoot/connections'
import { validateWebhookUrl } from '@vibesboard/data/validate-webhook-url'

export const runtime = 'nodejs'

const CreateConnectionSchema = z.object({
  // A tenant-supplied Chatwoot base URL that the server then calls with the
  // tenant's API token. Guard against SSRF into private/metadata endpoints —
  // without this, http://169.254.169.254/... would be a readable SSRF.
  chatwootUrl: z
    .string()
    .url('Invalid URL format')
    .refine(v => validateWebhookUrl(v).ok, {
      message:
        'URL resolves to a disallowed (private/loopback/metadata) address'
    }),
  apiToken: z.string().min(1, 'API token is required'),
  inboxId: z.number().int().positive('Invalid inbox ID'),
  enableAgentBot: z.boolean().optional().default(false),
  botName: z.string().optional()
})

type RouteParams = {
  params: Promise<{ id: string }>
}

async function findAgentWithOwnership(agentId: string, userId: string) {
  const agent = await getAgentById(agentId)
  if (!agent || agent.userId !== userId) return null
  return { agent, tenantId: agent.tenantId }
}

/**
 * POST /api/agents/[id]/chatwoot/connections
 * Create a new Chatwoot connection for an agent.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: agentId } = await params

    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const agentResult = await findAgentWithOwnership(agentId, auth.user.id)
    if (!agentResult) {
      return NextResponse.json(
        { error: 'Agent not found or unauthorized' },
        { status: 404 }
      )
    }

    const { tenantId } = agentResult

    const hasChatwoot = await isFeatureEnabled(tenantId, 'CHATWOOT')
    if (!hasChatwoot) {
      return NextResponse.json(
        { error: 'Chatwoot integration is not enabled for this tenant' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const validated = CreateConnectionSchema.parse(body)

    // 1. Validate credentials
    const credResult = await validateChatwootCredentials(
      validated.chatwootUrl,
      validated.apiToken
    )
    if (!credResult.valid) {
      return NextResponse.json(
        { error: `Invalid Chatwoot credentials: ${credResult.error}` },
        { status: 400 }
      )
    }

    // 2. Verify inbox exists
    const inboxes = await listChatwootInboxes(
      validated.chatwootUrl,
      validated.apiToken,
      credResult.accountId
    )
    const selectedInbox = inboxes.find(i => i.id === validated.inboxId)
    if (!selectedInbox) {
      return NextResponse.json(
        { error: 'Selected inbox not found in your Chatwoot account' },
        { status: 400 }
      )
    }

    // 3. Generate the opaque connection ID and build a canonical URL. Secrets
    // never belong in query strings: reverse proxies and access logs routinely
    // retain full request URLs.
    const connectionId = generateConnectionId()
    let appUrl = getCanonicalOrigin(request.nextUrl.origin)
    // Ensure HTTPS in production — HTTP webhooks get silently dropped by redirects
    if (!appUrl.startsWith('http://localhost')) {
      appUrl = appUrl.replace(/^http:\/\//, 'https://')
    }
    const webhookUrl = `${appUrl}/api/webhooks/chatwoot/${connectionId}`

    // 4. Create webhook in Chatwoot
    let chatwootWebhookId: number | null = null
    let webhookSigningSecret: string | null = null
    try {
      const webhook = await createChatwootWebhook(
        validated.chatwootUrl,
        validated.apiToken,
        credResult.accountId,
        webhookUrl
      )
      chatwootWebhookId = webhook.id
      webhookSigningSecret = webhook.secret?.trim() || null
    } catch (err) {
      console.error('[chatwoot] Failed to create webhook:', err)
      return NextResponse.json(
        {
          error:
            'Failed to create webhook in Chatwoot. Please ensure your token has permission to manage webhooks.'
        },
        { status: 400 }
      )
    }

    if (!webhookSigningSecret) {
      if (chatwootWebhookId) {
        await deleteChatwootWebhook(
          validated.chatwootUrl,
          validated.apiToken,
          credResult.accountId,
          chatwootWebhookId
        )
      }
      return NextResponse.json(
        {
          error:
            'This Chatwoot version does not provide signed webhooks. Upgrade Chatwoot and reconnect.'
        },
        { status: 400 }
      )
    }

    // 5. Create agent bot if requested
    let agentBotId: number | null = null
    let agentBotName: string | null = null
    let botAccessToken: string | null = null

    if (validated.enableAgentBot) {
      // 5a. Create the bot
      const botName = validated.botName?.trim() || 'AI Agent'
      let bot: { id: number; access_token: string } | null = null
      try {
        bot = await createChatwootAgentBot(
          validated.chatwootUrl,
          validated.apiToken,
          credResult.accountId,
          // Account webhooks deliver the signed event. Agent Bot outgoing
          // callbacks are unsigned, so do not register a second insecure path.
          { name: botName }
        )
        console.log(
          `[chatwoot] Agent bot created: id=${bot?.id}, has_token=${!!bot?.access_token}`
        )
      } catch (err) {
        console.error('[chatwoot] Failed to create agent bot:', err)
        // Roll back webhook
        if (chatwootWebhookId) {
          await deleteChatwootWebhook(
            validated.chatwootUrl,
            validated.apiToken,
            credResult.accountId,
            chatwootWebhookId
          )
        }
        return NextResponse.json(
          {
            error:
              'Failed to create agent bot. Verify the Chatwoot permissions and try again.'
          },
          { status: 400 }
        )
      }

      if (!bot?.id || !bot?.access_token) {
        console.error(
          '[chatwoot] Bot created but response missing id or access_token:',
          JSON.stringify(bot)
        )
        // Roll back webhook
        if (chatwootWebhookId) {
          await deleteChatwootWebhook(
            validated.chatwootUrl,
            validated.apiToken,
            credResult.accountId,
            chatwootWebhookId
          )
        }
        return NextResponse.json(
          {
            error:
              'Agent bot was created but Chatwoot returned an incomplete response (missing id or token). Check your Chatwoot version.'
          },
          { status: 400 }
        )
      }

      agentBotId = bot.id
      agentBotName = botName
      botAccessToken = bot.access_token

      // 5b. Assign bot to inbox
      try {
        await assignAgentBotToInbox(
          validated.chatwootUrl,
          validated.apiToken,
          credResult.accountId,
          validated.inboxId,
          bot.id
        )
        console.log(
          `[chatwoot] Agent bot ${bot.id} assigned to inbox ${validated.inboxId}`
        )
      } catch (err) {
        console.error('[chatwoot] Failed to assign agent bot to inbox:', err)
        // Roll back bot + webhook
        await deleteChatwootAgentBot(
          validated.chatwootUrl,
          validated.apiToken,
          credResult.accountId,
          bot.id
        )
        if (chatwootWebhookId) {
          await deleteChatwootWebhook(
            validated.chatwootUrl,
            validated.apiToken,
            credResult.accountId,
            chatwootWebhookId
          )
        }
        return NextResponse.json(
          {
            error:
              'Agent bot was created but could not be assigned to the inbox.'
          },
          { status: 400 }
        )
      }
    }

    // 6. Persist the connection
    const { connection } = await createChatwootConnection(
      tenantId,
      agentId,
      {
        chatwootUrl: validated.chatwootUrl,
        apiToken: validated.apiToken,
        accountId: credResult.accountId,
        inboxId: validated.inboxId,
        inboxName: selectedInbox.name,
        chatwootWebhookId,
        webhookSecret: webhookSigningSecret,
        agentBotId,
        agentBotName,
        botToken: botAccessToken,
        useAgentBot: validated.enableAgentBot
      },
      auth.user.id,
      connectionId
    )

    const {
      encryptedApiToken,
      webhookSecretHash,
      encryptedBotToken,
      ...safeConnection
    } = connection
    return NextResponse.json({ connection: safeConnection }, { status: 201 })
  } catch (error) {
    console.error('Error creating Chatwoot connection:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/agents/[id]/chatwoot/connections
 * List Chatwoot connections for an agent.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: agentId } = await params

    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const agentResult = await findAgentWithOwnership(agentId, auth.user.id)
    if (!agentResult) {
      return NextResponse.json(
        { error: 'Agent not found or unauthorized' },
        { status: 404 }
      )
    }

    const { tenantId } = agentResult

    const hasChatwoot = await isFeatureEnabled(tenantId, 'CHATWOOT')
    if (!hasChatwoot) {
      return NextResponse.json(
        { error: 'Chatwoot integration is not enabled for this tenant' },
        { status: 403 }
      )
    }

    const connections = await listChatwootConnections(tenantId, agentId)
    const safeConnections = connections.map(
      ({ encryptedApiToken, webhookSecretHash, encryptedBotToken, ...rest }) =>
        rest
    )

    return NextResponse.json({
      connections: safeConnections,
      total: safeConnections.length
    })
  } catch (error) {
    console.error('Error listing Chatwoot connections:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
