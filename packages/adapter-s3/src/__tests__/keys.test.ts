import { describe, it, expect } from 'vitest'
import { agentFileKey, isAgentFileKey, isCrossTenantFileKey } from '../keys.ts'
// Also re-exported from the package entry point.
import {
  agentFileKey as agentFileKeyFromIndex,
  isCrossTenantFileKey as isCrossTenantFileKeyFromIndex,
} from '../index.ts'

describe('agentFileKey', () => {
  it('builds the documented tenants/{tenantId}/agents/{agentId}/files/{fileName} layout', () => {
    expect(agentFileKey('t1', 'a1', 'doc.pdf')).toBe(
      'tenants/t1/agents/a1/files/doc.pdf',
    )
  })

  it('places the segments in tenant → agent → file order', () => {
    const key = agentFileKey('TENANT', 'AGENT', 'FILE')
    expect(key.split('/')).toEqual([
      'tenants',
      'TENANT',
      'agents',
      'AGENT',
      'files',
      'FILE',
    ])
  })

  it('keeps tenants isolated by prefix (no cross-tenant key collision)', () => {
    const a = agentFileKey('tenant-a', 'agent-1', 'same-name.txt')
    const b = agentFileKey('tenant-b', 'agent-1', 'same-name.txt')
    expect(a).not.toBe(b)
    expect(a.startsWith('tenants/tenant-a/')).toBe(true)
    expect(b.startsWith('tenants/tenant-b/')).toBe(true)
  })

  it('keeps agents isolated within a tenant', () => {
    const a = agentFileKey('tenant-a', 'agent-1', 'f.txt')
    const b = agentFileKey('tenant-a', 'agent-2', 'f.txt')
    expect(a).not.toBe(b)
  })

  it('passes through file names containing dots and dashes verbatim', () => {
    expect(agentFileKey('t', 'a', 'my-report.v2.final.pdf')).toBe(
      'tenants/t/agents/a/files/my-report.v2.final.pdf',
    )
  })

  it('does not encode or strip nested-path-like file names (raw interpolation)', () => {
    // The function performs no sanitization — it interpolates verbatim. This
    // documents current behavior (callers are responsible for safe names).
    expect(agentFileKey('t', 'a', 'sub/dir/file.txt')).toBe(
      'tenants/t/agents/a/files/sub/dir/file.txt',
    )
  })

  it('handles empty segments without throwing (documents current behavior)', () => {
    expect(agentFileKey('', '', '')).toBe('tenants//agents//files/')
  })

  it('is re-exported from the package index unchanged', () => {
    expect(agentFileKeyFromIndex).toBe(agentFileKey)
    expect(agentFileKeyFromIndex('t', 'a', 'f.txt')).toBe(
      'tenants/t/agents/a/files/f.txt',
    )
  })
})

describe('isAgentFileKey', () => {
  it('accepts the exact canonical single-segment key for the tenant+agent', () => {
    expect(isAgentFileKey('tenants/t1/agents/a1/files/doc.pdf', 't1', 'a1')).toBe(true)
  })

  it('rejects a different tenant or agent', () => {
    expect(isAgentFileKey('tenants/t2/agents/a1/files/doc.pdf', 't1', 'a1')).toBe(false)
    expect(isAgentFileKey('tenants/t1/agents/a2/files/doc.pdf', 't1', 'a1')).toBe(false)
  })

  it('rejects nested paths, traversal, and backslashes in the file segment', () => {
    expect(isAgentFileKey('tenants/t1/agents/a1/files/sub/dir/x.txt', 't1', 'a1')).toBe(false)
    expect(isAgentFileKey('tenants/t1/agents/a1/files/../../t2/agents/a1/files/x', 't1', 'a1')).toBe(false)
    expect(isAgentFileKey('tenants/t1/agents/a1/files/a\\b', 't1', 'a1')).toBe(false)
  })

  it('rejects the empty file segment', () => {
    expect(isAgentFileKey('tenants/t1/agents/a1/files/', 't1', 'a1')).toBe(false)
  })
})

describe('isCrossTenantFileKey', () => {
  it('flags a key that addresses another tenant', () => {
    expect(isCrossTenantFileKey('tenants/other/agents/a/files/x.pdf', 'mine')).toBe(true)
    expect(isCrossTenantFileKey('tenants/other/uploads/u/x.pdf', 'mine')).toBe(true)
  })

  it('allows same-tenant canonical and staging keys', () => {
    expect(isCrossTenantFileKey('tenants/mine/agents/a/files/x.pdf', 'mine')).toBe(false)
    expect(isCrossTenantFileKey('tenants/mine/uploads/u/x.pdf', 'mine')).toBe(false)
  })

  it('allows legacy flat staging keys (no tenants/ prefix)', () => {
    expect(isCrossTenantFileKey('user-123/x.pdf', 'mine')).toBe(false)
  })

  it('is not defeated by a tenant id that is a prefix of another', () => {
    // "mine" must not match "mine-evil" — the trailing slash guards this.
    expect(isCrossTenantFileKey('tenants/mine-evil/agents/a/files/x', 'mine')).toBe(true)
  })

  it('is re-exported from the package index', () => {
    expect(isCrossTenantFileKeyFromIndex).toBe(isCrossTenantFileKey)
  })
})
