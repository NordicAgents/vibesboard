import type { DataConnection } from '@vibesboard/adapter-postgres/schema'
import type { DataConnectionDocument } from '@vibesboard/contracts'

const orUndefined = <T>(v: T | null | undefined): T | undefined =>
  v ?? undefined

// Token + Google Sheets fields (kept small so lizard's `??`-per-branch
// counting stays well under the CCN budget).
const tokenFields = (r: DataConnection) => ({
  accessToken: orUndefined(r.accessTokenEncrypted),
  refreshToken: orUndefined(r.refreshTokenEncrypted),
  tokenExpiresAt: r.tokenExpiresAt?.toISOString(),
  email: orUndefined(r.email),
  spreadsheetId: orUndefined(r.spreadsheetId),
  sheetName: orUndefined(r.sheetName),
  scopes: orUndefined(r.scopes),
})

// Airtable + custom-webhook provider fields.
const providerFields = (r: DataConnection) => ({
  apiToken: orUndefined(r.apiTokenEncrypted),
  baseId: orUndefined(r.baseId),
  tableId: orUndefined(r.tableId),
  tableName: orUndefined(r.tableName),
  webhookUrl: orUndefined(r.webhookUrl),
  webhookMethod: orUndefined(r.webhookMethod),
  webhookHeaders: orUndefined(r.webhookHeaders),
})

export const rowToDataConnection = (
  r: DataConnection,
): DataConnectionDocument => ({
  id: r.id,
  tenantId: r.tenantId,
  provider: r.provider,
  name: r.name,
  ...tokenFields(r),
  ...providerFields(r),
  status: r.status,
  connectedBy: r.connectedBy ?? '',
  connectedAt: r.connectedAt.toISOString(),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})
