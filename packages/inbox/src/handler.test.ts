/**
 * Tests for the REAL inbound message handler (handler.ts): triggerInboxAgent
 * and the orchestration it drives through handleInboxAgentMessage.
 *
 * handler.ts wires together many collaborators. Per the package guidance we
 * stub the AI runtime (runAgentStream) and the channel SEND adapters
 * (reply-adapters), and we mock the remaining data-access collaborators so the
 * real control flow (handoff gate, 24h window gate, conversation ensure, stream
 * drain -> onCompletion, reply dispatch, handoff write-back, conversation
 * linking) is what's under test. completion.ts helpers (detectCompletionMarker /
 * stripCompletionMarkers) are used REAL.
 *
 * vi.mock('@vibesboard/ai/runtime', factory) replaces the module without
 * importing the real one, so its transitive @ai-sdk/openai + ai deps never load.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { VibeAgent } from '@vibesboard/contracts'

// ─── Collaborator mocks ─────────────────────────────────────────────────────
vi.mock('./resolve-agent.ts', () => ({
  resolveInboxAgent: vi.fn()
}))
vi.mock('./reply-adapters.ts', () => ({
  sendWhatsAppAgentReply: vi.fn(),
  sendInstagramAgentReply: vi.fn()
}))
vi.mock('@vibesboard/ai/runtime', () => ({
  runAgentStream: vi.fn()
}))
// completion.ts is pure (only imports ./prompts.ts) — keep it REAL so the
// handler's marker detect/strip runs for real. We re-export the actual module
// so vitest resolves the subpath specifier consistently alongside the mocked
// `@vibesboard/ai/runtime` sibling.
vi.mock('@vibesboard/ai/completion', async () => {
  return await vi.importActual('@vibesboard/ai/completion')
})
vi.mock('@vibesboard/agents/conversations', () => ({
  ensureConversation: vi.fn(),
  isConversationHandedOff: vi.fn(),
  markConversationHandedOff: vi.fn(),
  updateConversationMessages: vi.fn()
}))
vi.mock('@vibesboard/agents/notifications', () => ({
  dispatchAgentNotification: vi.fn(),
  mapCompletionToEvent: vi.fn(() => null)
}))
vi.mock('@vibesboard/agents/auto-summarize', () => ({
  maybeAutoSummarize: vi.fn(async () => undefined)
}))
vi.mock('@vibesboard/channel-whatsapp/conversations', () => ({
  getConversation: vi.fn(),
  setConversationHandoff: vi.fn(),
  linkAgentConversation: vi.fn()
}))
vi.mock('@vibesboard/channel-instagram/conversations', () => ({
  getConversation: vi.fn(),
  setConversationHandoff: vi.fn(),
  linkAgentConversation: vi.fn()
}))

import { resolveInboxAgent } from './resolve-agent.ts'
import { sendWhatsAppAgentReply, sendInstagramAgentReply } from './reply-adapters.ts'
import { runAgentStream } from '@vibesboard/ai/runtime'
import {
  ensureConversation,
  isConversationHandedOff,
  markConversationHandedOff,
  updateConversationMessages
} from '@vibesboard/agents/conversations'
import { dispatchAgentNotification, mapCompletionToEvent } from '@vibesboard/agents/notifications'
import * as wa from '@vibesboard/channel-whatsapp/conversations'
import * as ig from '@vibesboard/channel-instagram/conversations'

import { triggerInboxAgent, type InboxAgentContext } from './handler.ts'

const mockResolve = vi.mocked(resolveInboxAgent)
const mockWaReply = vi.mocked(sendWhatsAppAgentReply)
const mockIgReply = vi.mocked(sendInstagramAgentReply)
const mockRunStream = vi.mocked(runAgentStream)
const mockEnsure = vi.mocked(ensureConversation)
const mockIsHandedOff = vi.mocked(isConversationHandedOff)
const mockMarkHandedOff = vi.mocked(markConversationHandedOff)
const mockUpdateMessages = vi.mocked(updateConversationMessages)
const mockDispatch = vi.mocked(dispatchAgentNotification)
const mockMapEvent = vi.mocked(mapCompletionToEvent)
const mockWaGetConvo = vi.mocked(wa.getConversation)
const mockWaSetHandoff = vi.mocked(wa.setConversationHandoff)
const mockWaLink = vi.mocked(wa.linkAgentConversation)
const mockIgGetConvo = vi.mocked(ig.getConversation)
const mockIgSetHandoff = vi.mocked(ig.setConversationHandoff)

function fakeAgent(): VibeAgent {
  return {
    id: 'agent-1',
    tenantId: 'tenant-1',
    name: 'Helper',
    instructions: 'Base instructions.'
  } as unknown as VibeAgent
}

/**
 * Build a runAgentStream mock that, when its returned stream is drained,
 * invokes the supplied onCompletion with `completion` (mirroring the real
 * runtime's behaviour of firing onCompletion once at the end).
 */
function streamYielding(completion: string) {
  return vi.fn(async ({ onCompletion }: { onCompletion?: (c: string) => any }) => {
    return new ReadableStream<string>({
      async start(controller) {
        if (onCompletion) await onCompletion(completion)
        controller.close()
      }
    })
  })
}

function ctx(overrides: Partial<InboxAgentContext> = {}): InboxAgentContext {
  return {
    channel: 'whatsapp',
    tenantId: 'tenant-1',
    accountId: 'account-1',
    contactId: 'contact-1',
    messageText: 'Hi there',
    windowExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockResolve.mockResolvedValue({ agentId: 'agent-1', agent: fakeAgent() })
  mockIsHandedOff.mockResolvedValue(false)
  mockEnsure.mockResolvedValue({
    id: 'agent-convo-1',
    agentId: 'agent-1',
    userId: null,
    externalId: 'inbox:whatsapp:account-1:contact-1',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as any)
  mockUpdateMessages.mockResolvedValue(undefined)
  mockMarkHandedOff.mockResolvedValue(undefined)
  mockDispatch.mockReturnValue(undefined)
  mockMapEvent.mockReturnValue(null)
  mockWaGetConvo.mockResolvedValue({ id: 'wa-convo-1' } as any)
  mockWaSetHandoff.mockResolvedValue(undefined)
  mockWaLink.mockResolvedValue(undefined)
  mockIgGetConvo.mockResolvedValue({ id: 'ig-convo-1' } as any)
  mockIgSetHandoff.mockResolvedValue(undefined)
  mockWaReply.mockResolvedValue({ id: 'wa-out-1' } as any)
  mockIgReply.mockResolvedValue({ id: 'ig-out-1' } as any)
  mockRunStream.mockImplementation(streamYielding('Hello back!') as any)
})

describe('triggerInboxAgent — guard rails', () => {
  it('does nothing when messageText is empty', async () => {
    await triggerInboxAgent(ctx({ messageText: '' }))
    expect(mockResolve).not.toHaveBeenCalled()
    expect(mockRunStream).not.toHaveBeenCalled()
    expect(mockWaReply).not.toHaveBeenCalled()
  })

  it('does nothing when no agent resolves', async () => {
    mockResolve.mockResolvedValue(null)
    await triggerInboxAgent(ctx())
    expect(mockEnsure).not.toHaveBeenCalled()
    expect(mockRunStream).not.toHaveBeenCalled()
    expect(mockWaReply).not.toHaveBeenCalled()
  })

  it('passes the channel-specific resolution arguments through', async () => {
    await triggerInboxAgent(ctx({ channel: 'instagram', contactId: 'igsid-9' }))
    expect(mockResolve).toHaveBeenCalledWith('tenant-1', 'account-1', 'igsid-9', 'instagram')
  })
})

describe('triggerInboxAgent — happy path (whatsapp)', () => {
  it('ensures a conversation, runs the stream, and sends the reply', async () => {
    await triggerInboxAgent(ctx())

    expect(mockEnsure).toHaveBeenCalledTimes(1)
    const ensureArg = mockEnsure.mock.calls[0][0]
    expect(ensureArg.tenantId).toBe('tenant-1')
    expect(ensureArg.agentId).toBe('agent-1')
    expect(ensureArg.externalId).toBe('inbox:whatsapp:account-1:contact-1')
    expect(ensureArg.initialMessages![0]).toMatchObject({ role: 'user', content: 'Hi there' })

    expect(mockRunStream).toHaveBeenCalledTimes(1)
    expect(mockWaReply).toHaveBeenCalledTimes(1)
    expect(mockWaReply).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        accountId: 'account-1',
        contactId: 'contact-1',
        text: 'Hello back!',
        agentId: 'agent-1',
        agentName: 'Helper'
      })
    )
    expect(mockIgReply).not.toHaveBeenCalled()
  })

  it('appends the handoff instruction suffix to the agent passed to the runtime', async () => {
    await triggerInboxAgent(ctx())
    const runArg = mockRunStream.mock.calls[0][0]
    expect(runArg.agent.instructions).toContain('Base instructions.')
    expect(runArg.agent.instructions).toContain('[HANDOFF_TO_HUMAN]')
  })

  it('persists the assistant message via updateConversationMessages', async () => {
    await triggerInboxAgent(ctx())
    expect(mockUpdateMessages).toHaveBeenCalledTimes(1)
    const arg = mockUpdateMessages.mock.calls[0][0]
    const last = arg.messages[arg.messages.length - 1]
    expect(last).toMatchObject({ role: 'assistant', content: 'Hello back!' })
  })

  it('links the agent conversation to the channel conversation on first message', async () => {
    // ensureConversation returns a brand-new conversation (messages length <= 1).
    mockEnsure.mockResolvedValue({
      id: 'agent-convo-1',
      agentId: 'agent-1',
      userId: null,
      externalId: 'inbox:whatsapp:account-1:contact-1',
      messages: [{ id: 'm1', role: 'user', content: 'Hi there' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } as any)

    await triggerInboxAgent(ctx())

    expect(mockWaLink).toHaveBeenCalledWith('tenant-1', 'wa-convo-1', 'agent-convo-1')
  })

  it('does not link again when the conversation already has history', async () => {
    mockEnsure.mockResolvedValue({
      id: 'agent-convo-1',
      agentId: 'agent-1',
      userId: null,
      externalId: 'inbox:whatsapp:account-1:contact-1',
      messages: [
        { id: 'm1', role: 'user', content: 'old' },
        { id: 'm2', role: 'assistant', content: 'older reply' }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } as any)

    await triggerInboxAgent(ctx())

    expect(mockWaLink).not.toHaveBeenCalled()
  })
})

describe('triggerInboxAgent — happy path (instagram routing)', () => {
  it('routes the reply through the Instagram adapter for instagram channel', async () => {
    await triggerInboxAgent(ctx({ channel: 'instagram', contactId: 'igsid-1' }))

    expect(mockIgReply).toHaveBeenCalledTimes(1)
    expect(mockIgReply).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'igsid-1', text: 'Hello back!' })
    )
    expect(mockWaReply).not.toHaveBeenCalled()
    // Instagram conversation lookups used, not WhatsApp.
    expect(mockIgGetConvo).toHaveBeenCalled()
    expect(mockWaGetConvo).not.toHaveBeenCalled()
  })
})

describe('triggerInboxAgent — gating', () => {
  it('skips entirely when the conversation is already handed off', async () => {
    mockIsHandedOff.mockResolvedValue(true)
    await triggerInboxAgent(ctx())
    expect(mockRunStream).not.toHaveBeenCalled()
    expect(mockWaReply).not.toHaveBeenCalled()
  })

  it('skips when the 24h messaging window has expired', async () => {
    await triggerInboxAgent(ctx({ windowExpiresAt: new Date(Date.now() - 1000).toISOString() }))
    expect(mockEnsure).not.toHaveBeenCalled()
    expect(mockRunStream).not.toHaveBeenCalled()
    expect(mockWaReply).not.toHaveBeenCalled()
  })

  it('does not send a reply when the stream produces empty text', async () => {
    mockRunStream.mockImplementation(streamYielding('') as any)
    await triggerInboxAgent(ctx())
    expect(mockWaReply).not.toHaveBeenCalled()
  })
})

describe('triggerInboxAgent — handoff flow', () => {
  beforeEach(() => {
    // Use the REAL detectCompletionMarker/stripCompletionMarkers via handler;
    // a [HANDOFF_TO_HUMAN] marker should trigger the handoff path.
    mockRunStream.mockImplementation(
      streamYielding('Connecting you to a human. [HANDOFF_TO_HUMAN]') as any
    )
  })

  it('strips the marker from the reply text before sending', async () => {
    await triggerInboxAgent(ctx())
    expect(mockWaReply).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Connecting you to a human.' })
    )
  })

  it('marks the agent conversation handed off and reflects it on the channel row', async () => {
    await triggerInboxAgent(ctx())
    expect(mockMarkHandedOff).toHaveBeenCalledWith('tenant-1', 'agent-1', 'agent-convo-1')
    expect(mockWaSetHandoff).toHaveBeenCalledWith('tenant-1', 'wa-convo-1', true)
  })

  it('reflects handoff on the Instagram row for instagram channel', async () => {
    await triggerInboxAgent(ctx({ channel: 'instagram', contactId: 'igsid-1' }))
    expect(mockIgSetHandoff).toHaveBeenCalledWith('tenant-1', 'ig-convo-1', true)
    expect(mockWaSetHandoff).not.toHaveBeenCalled()
  })

  it('dispatches a notification when the completion maps to an event', async () => {
    mockMapEvent.mockReturnValue('handoff' as any)
    await triggerInboxAgent(ctx())
    expect(mockDispatch).toHaveBeenCalledTimes(1)
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'handoff', conversationId: 'agent-convo-1' })
    )
  })

  it('does not dispatch a notification when there is no mapped event', async () => {
    mockMapEvent.mockReturnValue(null)
    await triggerInboxAgent(ctx())
    expect(mockDispatch).not.toHaveBeenCalled()
  })
})

describe('triggerInboxAgent — error resilience', () => {
  it('swallows downstream errors so the webhook caller never throws', async () => {
    // ensureConversation throwing must not propagate (handler wraps in try/catch).
    mockEnsure.mockRejectedValue(new Error('db blew up'))
    await expect(triggerInboxAgent(ctx())).resolves.toBeUndefined()
    expect(mockWaReply).not.toHaveBeenCalled()
  })

  it('does not abort message handling when handoff write-back fails', async () => {
    mockRunStream.mockImplementation(
      streamYielding('bye [HANDOFF_TO_HUMAN]') as any
    )
    mockMarkHandedOff.mockRejectedValue(new Error('handoff write failed'))
    // The reply was already sent before the handoff step; handler must not throw.
    await expect(triggerInboxAgent(ctx())).resolves.toBeUndefined()
    expect(mockWaReply).toHaveBeenCalledTimes(1)
  })
})
