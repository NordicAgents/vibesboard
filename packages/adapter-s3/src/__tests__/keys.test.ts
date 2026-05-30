import { describe, it, expect } from 'vitest'
import { agentFileKey } from '../keys.ts'
// Also re-exported from the package entry point.
import { agentFileKey as agentFileKeyFromIndex } from '../index.ts'

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
