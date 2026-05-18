/**
 * File-key path scheme used by the app. Kept identical to the previous
 * GCS layout so existing file_keys stored in the DB remain valid.
 *
 *   tenants/{tenantId}/agents/{agentId}/files/{fileName}
 */
export function agentFileKey(tenantId: string, agentId: string, fileName: string): string {
  return `tenants/${tenantId}/agents/${agentId}/files/${fileName}`
}
