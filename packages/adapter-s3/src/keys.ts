/**
 * File-key path scheme used by the app. Kept identical to the previous
 * GCS layout so existing file_keys stored in the DB remain valid.
 *
 *   tenants/{tenantId}/agents/{agentId}/files/{fileName}
 */
export function agentFileKey(tenantId: string, agentId: string, fileName: string): string {
  return `tenants/${tenantId}/agents/${agentId}/files/${fileName}`
}

/**
 * True iff `key` is the exact canonical single-segment file path for this
 * tenant+agent — i.e. `tenants/{tenantId}/agents/{agentId}/files/{fileName}`
 * with no nested path, backslash, or `..` traversal in the file segment.
 */
export function isAgentFileKey(
  key: string,
  tenantId: string,
  agentId: string,
): boolean {
  const prefix = `tenants/${tenantId}/agents/${agentId}/files/`
  if (!key.startsWith(prefix)) return false
  const rest = key.slice(prefix.length)
  return rest.length > 0 && !rest.includes('/') && !rest.includes('\\') && !rest.includes('..')
}

/**
 * True iff `key` explicitly addresses a DIFFERENT tenant's namespace
 * (`tenants/{otherTenant}/…`). This is the guard that stops a caller from
 * attaching, downloading, ingesting, or deleting another tenant's storage
 * object via an agent they control.
 *
 * Same-tenant keys (`tenants/{tenantId}/…`, canonical agent files or
 * `tenants/{tenantId}/uploads/…` staging) return false, as do legacy flat
 * staging keys (`{userId}/{fileName}`) which carry no `tenants/` prefix and so
 * cannot address another tenant by construction.
 */
export function isCrossTenantFileKey(key: string, tenantId: string): boolean {
  if (!key.startsWith('tenants/')) return false
  return !key.startsWith(`tenants/${tenantId}/`)
}
