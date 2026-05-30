/**
 * Tests for the REAL `resolveInboxAgent` resolution function (resolve-agent.ts).
 *
 * resolveInboxAgent reads channel conversation + account rows and loads the
 * agent. Its data-access dependencies (channel-whatsapp/instagram conversations
 * & accounts, and agents/server getAgentForMember) all reach Postgres via
 * getMigrateDb() internally with NO db-injection seam exposed to resolve-agent.
 * So here we mock those data-access modules to drive every branch of the real
 * decision tree, and assert which agent (if any) is resolved and that tenant
 * isolation is honoured.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { VibeAgent } from '@vibesboard/contracts'

// ─── Mock the data-access modules resolve-agent.ts imports ──────────────────
vi.mock('@vibesboard/channel-whatsapp/conversations', () => ({
  getConversation: vi.fn()
}))
vi.mock('@vibesboard/channel-whatsapp/accounts', () => ({
  getInboxAccount: vi.fn()
}))
vi.mock('@vibesboard/channel-instagram/conversations', () => ({
  getConversation: vi.fn()
}))
vi.mock('@vibesboard/channel-instagram/accounts', () => ({
  getInboxAccount: vi.fn()
}))
vi.mock('@vibesboard/agents/server', () => ({
  getAgentForMember: vi.fn()
}))

import * as wa from '@vibesboard/channel-whatsapp/conversations'
import * as waAcc from '@vibesboard/channel-whatsapp/accounts'
import * as ig from '@vibesboard/channel-instagram/conversations'
import * as igAcc from '@vibesboard/channel-instagram/accounts'
import { getAgentForMember } from '@vibesboard/agents/server'

import { resolveInboxAgent } from './resolve-agent.ts'

const waGetConversation = vi.mocked(wa.getConversation)
const waGetAccount = vi.mocked(waAcc.getInboxAccount)
const igGetConversation = vi.mocked(ig.getConversation)
const igGetAccount = vi.mocked(igAcc.getInboxAccount)
const mockGetAgent = vi.mocked(getAgentForMember)

const TENANT = 'tenant-1'
const ACCOUNT = 'account-1'
const CONTACT = 'contact-1'

function fakeAgent(id: string): VibeAgent {
  return {
    id,
    tenantId: TENANT,
    name: `Agent ${id}`,
    instructions: 'You are helpful.'
  } as unknown as VibeAgent
}

beforeEach(() => {
  vi.clearAllMocks()
  // Sensible defaults: no rows, no agent.
  waGetConversation.mockResolvedValue(null)
  waGetAccount.mockResolvedValue(null)
  igGetConversation.mockResolvedValue(null)
  igGetAccount.mockResolvedValue(null)
  mockGetAgent.mockResolvedValue(null)
})

describe('resolveInboxAgent — WhatsApp channel', () => {
  it('uses the per-conversation assignedAgentId override', async () => {
    waGetConversation.mockResolvedValue({ assignedAgentId: 'convo-agent' } as any)
    mockGetAgent.mockResolvedValue(fakeAgent('convo-agent'))

    const result = await resolveInboxAgent(TENANT, ACCOUNT, CONTACT, 'whatsapp')

    expect(result).not.toBeNull()
    expect(result!.agentId).toBe('convo-agent')
    expect(result!.agent.id).toBe('convo-agent')
    // Override means the account is never consulted.
    expect(waGetAccount).not.toHaveBeenCalled()
    expect(mockGetAgent).toHaveBeenCalledWith(TENANT, 'convo-agent')
  })

  it('falls back to the account assignedAgentId when no conversation override', async () => {
    waGetConversation.mockResolvedValue({ assignedAgentId: null } as any)
    waGetAccount.mockResolvedValue({ assignedAgentId: 'account-agent', agentAutoReply: true } as any)
    mockGetAgent.mockResolvedValue(fakeAgent('account-agent'))

    const result = await resolveInboxAgent(TENANT, ACCOUNT, CONTACT, 'whatsapp')

    expect(result!.agentId).toBe('account-agent')
    expect(waGetAccount).toHaveBeenCalledWith(TENANT, ACCOUNT)
  })

  it('returns null when the conversation is paused', async () => {
    waGetConversation.mockResolvedValue({
      assignedAgentId: 'agent-x',
      agentPaused: true
    } as any)

    const result = await resolveInboxAgent(TENANT, ACCOUNT, CONTACT, 'whatsapp')

    expect(result).toBeNull()
    expect(mockGetAgent).not.toHaveBeenCalled()
  })

  it('returns null when the conversation is handed off', async () => {
    waGetConversation.mockResolvedValue({
      assignedAgentId: 'agent-x',
      agentHandedOff: true
    } as any)

    const result = await resolveInboxAgent(TENANT, ACCOUNT, CONTACT, 'whatsapp')

    expect(result).toBeNull()
    expect(mockGetAgent).not.toHaveBeenCalled()
  })

  it('returns null when the account has agentAutoReply=false', async () => {
    waGetConversation.mockResolvedValue(null)
    waGetAccount.mockResolvedValue({ assignedAgentId: 'agent-x', agentAutoReply: false } as any)

    const result = await resolveInboxAgent(TENANT, ACCOUNT, CONTACT, 'whatsapp')

    expect(result).toBeNull()
    expect(mockGetAgent).not.toHaveBeenCalled()
  })

  it('treats undefined agentAutoReply as enabled (only strict false skips)', async () => {
    waGetConversation.mockResolvedValue(null)
    waGetAccount.mockResolvedValue({ assignedAgentId: 'account-agent' } as any)
    mockGetAgent.mockResolvedValue(fakeAgent('account-agent'))

    const result = await resolveInboxAgent(TENANT, ACCOUNT, CONTACT, 'whatsapp')

    expect(result!.agentId).toBe('account-agent')
  })

  it('returns null when no account row exists', async () => {
    waGetConversation.mockResolvedValue(null)
    waGetAccount.mockResolvedValue(null)

    const result = await resolveInboxAgent(TENANT, ACCOUNT, CONTACT, 'whatsapp')

    expect(result).toBeNull()
    expect(mockGetAgent).not.toHaveBeenCalled()
  })

  it('returns null when no agent is assigned anywhere', async () => {
    waGetConversation.mockResolvedValue(null)
    waGetAccount.mockResolvedValue({ assignedAgentId: null, agentAutoReply: true } as any)

    const result = await resolveInboxAgent(TENANT, ACCOUNT, CONTACT, 'whatsapp')

    expect(result).toBeNull()
    expect(mockGetAgent).not.toHaveBeenCalled()
  })

  it('returns null when the resolved agent cannot be loaded (deleted/cross-tenant)', async () => {
    waGetConversation.mockResolvedValue({ assignedAgentId: 'ghost-agent' } as any)
    // getAgentForMember enforces tenant ownership; null => not found for tenant.
    mockGetAgent.mockResolvedValue(null)

    const result = await resolveInboxAgent(TENANT, ACCOUNT, CONTACT, 'whatsapp')

    expect(result).toBeNull()
    expect(mockGetAgent).toHaveBeenCalledWith(TENANT, 'ghost-agent')
  })

  it('passes the caller tenantId (not a fixed one) to getAgentForMember (tenant isolation)', async () => {
    waGetConversation.mockResolvedValue({ assignedAgentId: 'agent-x' } as any)
    mockGetAgent.mockResolvedValue(fakeAgent('agent-x'))

    await resolveInboxAgent('tenant-OTHER', ACCOUNT, CONTACT, 'whatsapp')

    expect(mockGetAgent).toHaveBeenCalledWith('tenant-OTHER', 'agent-x')
  })

  it('does not consult Instagram data sources for a whatsapp request', async () => {
    waGetConversation.mockResolvedValue({ assignedAgentId: 'agent-x' } as any)
    mockGetAgent.mockResolvedValue(fakeAgent('agent-x'))

    await resolveInboxAgent(TENANT, ACCOUNT, CONTACT, 'whatsapp')

    expect(igGetConversation).not.toHaveBeenCalled()
    expect(igGetAccount).not.toHaveBeenCalled()
  })
})

describe('resolveInboxAgent — Instagram channel', () => {
  it('uses the per-conversation override', async () => {
    igGetConversation.mockResolvedValue({ assignedAgentId: 'ig-convo-agent' } as any)
    mockGetAgent.mockResolvedValue(fakeAgent('ig-convo-agent'))

    const result = await resolveInboxAgent(TENANT, ACCOUNT, CONTACT, 'instagram')

    expect(result!.agentId).toBe('ig-convo-agent')
    expect(igGetAccount).not.toHaveBeenCalled()
  })

  it('falls back to the account default', async () => {
    igGetConversation.mockResolvedValue(null)
    igGetAccount.mockResolvedValue({ assignedAgentId: 'ig-account-agent', agentAutoReply: true } as any)
    mockGetAgent.mockResolvedValue(fakeAgent('ig-account-agent'))

    const result = await resolveInboxAgent(TENANT, ACCOUNT, CONTACT, 'instagram')

    expect(result!.agentId).toBe('ig-account-agent')
  })

  it('returns null when handed off', async () => {
    igGetConversation.mockResolvedValue({
      assignedAgentId: 'agent-x',
      agentHandedOff: true
    } as any)

    const result = await resolveInboxAgent(TENANT, ACCOUNT, CONTACT, 'instagram')

    expect(result).toBeNull()
  })

  it('returns null when account agentAutoReply is false', async () => {
    igGetConversation.mockResolvedValue(null)
    igGetAccount.mockResolvedValue({ assignedAgentId: 'agent-x', agentAutoReply: false } as any)

    const result = await resolveInboxAgent(TENANT, ACCOUNT, CONTACT, 'instagram')

    expect(result).toBeNull()
  })

  it('does not consult WhatsApp data sources for an instagram request', async () => {
    igGetConversation.mockResolvedValue({ assignedAgentId: 'agent-x' } as any)
    mockGetAgent.mockResolvedValue(fakeAgent('agent-x'))

    await resolveInboxAgent(TENANT, ACCOUNT, CONTACT, 'instagram')

    expect(waGetConversation).not.toHaveBeenCalled()
    expect(waGetAccount).not.toHaveBeenCalled()
  })
})
