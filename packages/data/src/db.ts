import type { DataConnection } from '@vibesboard/adapter-postgres/schema'
import type { DataConnectionDocument } from '@vibesboard/contracts'

export const rowToDataConnection = (
  r: DataConnection,
): DataConnectionDocument => ({
  id: r.id,
  tenantId: r.tenantId,
  provider: r.provider,
  name: r.name,
  accessToken: r.accessTokenEncrypted ?? undefined,
  refreshToken: r.refreshTokenEncrypted ?? undefined,
  tokenExpiresAt: r.tokenExpiresAt?.toISOString(),
  email: r.email ?? undefined,
  spreadsheetId: r.spreadsheetId ?? undefined,
  sheetName: r.sheetName ?? undefined,
  scopes: r.scopes ?? undefined,
  apiToken: r.apiTokenEncrypted ?? undefined,
  baseId: r.baseId ?? undefined,
  tableId: r.tableId ?? undefined,
  tableName: r.tableName ?? undefined,
  webhookUrl: r.webhookUrl ?? undefined,
  webhookMethod: r.webhookMethod ?? undefined,
  webhookHeaders: r.webhookHeaders ?? undefined,
  status: r.status,
  connectedBy: r.connectedBy ?? '',
  connectedAt: r.connectedAt.toISOString(),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})
