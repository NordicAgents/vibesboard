import { describe, it, expect } from 'vitest'
import { Collections } from './domain-types.ts'

/**
 * `Collections` is the only runtime value the contracts package exports. It is
 * the single source of truth for collection paths used across the monorepo, so
 * its constants and path-builders are a real, testable contract. Many of these
 * paths are tenant-scoped — getting the tenant segment right is a multi-tenant
 * isolation invariant, so we assert tenant/agent ids land in the correct
 * positions and that distinct tenants never collide.
 */
describe('Collections', () => {
  describe('top-level string constants', () => {
    it('exposes the expected fixed collection names', () => {
      expect(Collections.users).toBe('users')
      expect(Collections.tenants).toBe('tenants')
      expect(Collections.tenantSlugs).toBe('tenant_slugs')
      expect(Collections.featureFlags).toBe('feature_flags')
      expect(Collections.invitations).toBe('invitations')
      expect(Collections.chats).toBe('chats')
      expect(Collections.planTemplates).toBe('plan_templates')
      expect(Collections.platformConfig).toBe('platform_config')
    })
  })

  describe('tenant-scoped path builders', () => {
    const tenantId = 'tenant_abc'

    it('nest every tenant-scoped path under the tenant id', () => {
      expect(Collections.agentLinks(tenantId)).toBe(`tenants/${tenantId}/agent_links`)
      expect(Collections.branding(tenantId)).toBe(`tenants/${tenantId}/branding`)
      expect(Collections.members(tenantId)).toBe(`tenants/${tenantId}/members`)
      expect(Collections.featureToggles(tenantId)).toBe(`tenants/${tenantId}/feature_toggles`)
      expect(Collections.agents(tenantId)).toBe(`tenants/${tenantId}/agents`)
      expect(Collections.notifications(tenantId)).toBe(`tenants/${tenantId}/notifications`)
      expect(Collections.calendarConnections(tenantId)).toBe(
        `tenants/${tenantId}/calendar_connections`,
      )
      expect(Collections.dataConnections(tenantId)).toBe(`tenants/${tenantId}/data_connections`)
      expect(Collections.whatsappInboxAccounts(tenantId)).toBe(
        `tenants/${tenantId}/whatsapp_inbox_accounts`,
      )
      expect(Collections.instagramInboxAccounts(tenantId)).toBe(
        `tenants/${tenantId}/instagram_inbox_accounts`,
      )
      expect(Collections.usageLogs(tenantId)).toBe(`tenants/${tenantId}/usage_logs`)
      expect(Collections.usageRollups(tenantId)).toBe(`tenants/${tenantId}/usage_rollups`)
    })

    it('keeps two different tenants on fully disjoint paths (isolation)', () => {
      const a = Collections.agents('tenant_a')
      const b = Collections.agents('tenant_b')
      expect(a).not.toBe(b)
      expect(a.startsWith('tenants/tenant_a/')).toBe(true)
      expect(b.startsWith('tenants/tenant_b/')).toBe(true)
    })
  })

  describe('agent-scoped path builders', () => {
    const tenantId = 'tenant_abc'
    const agentId = 'agent_xyz'

    it('nest agent-scoped paths under both tenant and agent ids in order', () => {
      const prefix = `tenants/${tenantId}/agents/${agentId}`
      expect(Collections.conversations(tenantId, agentId)).toBe(`${prefix}/conversations`)
      expect(Collections.agentFiles(tenantId, agentId)).toBe(`${prefix}/files`)
      expect(Collections.fileChunks(tenantId, agentId)).toBe(`${prefix}/file_chunks`)
      expect(Collections.conversationChunks(tenantId, agentId)).toBe(
        `${prefix}/conversation_chunks`,
      )
      expect(Collections.chatwootConnections(tenantId, agentId)).toBe(
        `${prefix}/chatwoot_connections`,
      )
      expect(Collections.bookings(tenantId, agentId)).toBe(`${prefix}/bookings`)
      expect(Collections.bookingEnquiries(tenantId, agentId)).toBe(`${prefix}/bookingEnquiries`)
      expect(Collections.dataLogs(tenantId, agentId)).toBe(`${prefix}/data_logs`)
      expect(Collections.hooks(tenantId, agentId)).toBe(`${prefix}/hooks`)
      expect(Collections.inviteCodes(tenantId, agentId)).toBe(`${prefix}/invite_codes`)
      expect(Collections.conversationRefs(tenantId, agentId)).toBe(`${prefix}/conversation_refs`)
    })

    it('places the tenant id before the agent id (not swapped)', () => {
      const path = Collections.conversations('TID', 'AID')
      expect(path).toBe('tenants/TID/agents/AID/conversations')
      // Guard against an argument-order regression that would leak the agent id
      // into the tenant slot.
      expect(path).not.toContain('tenants/AID/')
    })
  })

  describe('deeply nested / multi-arg builders', () => {
    it('builds the hook-jobs path with tenant, agent, and hook ids', () => {
      expect(Collections.hookJobs('t1', 'a1', 'h1')).toBe(
        'tenants/t1/agents/a1/hooks/h1/jobs',
      )
    })

    it('builds the whatsapp messages path with tenant, account, and contact ids', () => {
      expect(Collections.whatsappInboxMessages('t1', 'acc1', '+15551234')).toBe(
        'tenants/t1/whatsapp_inbox_accounts/acc1/conversations/+15551234/messages',
      )
    })

    it('builds the whatsapp conversations path with tenant and account ids', () => {
      expect(Collections.whatsappInboxConversations('t1', 'acc1')).toBe(
        'tenants/t1/whatsapp_inbox_accounts/acc1/conversations',
      )
    })

    it('builds the instagram messages path with tenant, account, and contact ids', () => {
      expect(Collections.instagramInboxMessages('t1', 'acc1', 'igsid1')).toBe(
        'tenants/t1/instagram_inbox_accounts/acc1/conversations/igsid1/messages',
      )
    })

    it('builds the instagram conversations path with tenant and account ids', () => {
      expect(Collections.instagramInboxConversations('t1', 'acc1')).toBe(
        'tenants/t1/instagram_inbox_accounts/acc1/conversations',
      )
    })
  })

  describe('builder hygiene', () => {
    it('exposes builders as callable functions and constants as strings', () => {
      expect(Collections.agents).toBeTypeOf('function')
      expect(Collections.hookJobs).toBeTypeOf('function')
      expect(Collections.users).toBeTypeOf('string')
    })

    it('returns a fresh string each call (no shared mutable state)', () => {
      const first = Collections.agents('t')
      const second = Collections.agents('t')
      expect(first).toBe(second)
    })

    it('does not URL-encode or mangle ids passed through builders', () => {
      // The builders are simple template strings: whatever id you pass is
      // interpolated verbatim. Pin that so callers know encoding is their job.
      expect(Collections.agents('a/b')).toBe('tenants/a/b/agents')
    })
  })
})
