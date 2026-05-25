import type { CalendarConnection } from '@vibesboard/adapter-postgres/schema'
import type { CalendarConnectionDocument } from '@vibesboard/contracts'

export const rowToCalendarConnection = (
  r: CalendarConnection,
): CalendarConnectionDocument => ({
  id: r.id,
  tenantId: r.tenantId,
  provider: r.provider,
  name: r.name,
  calendarId: r.calendarId,
  accessToken: r.accessTokenEncrypted,
  refreshToken: r.refreshTokenEncrypted,
  tokenExpiresAt: r.tokenExpiresAt?.toISOString() ?? new Date(0).toISOString(),
  apiKey: r.apiKeyEncrypted ?? undefined,
  apiBaseUrl: r.apiBaseUrl ?? undefined,
  email: r.email ?? undefined,
  scopes: r.scopes ?? [],
  status: r.status,
  connectedBy: r.connectedBy ?? '',
  connectedAt: r.connectedAt.toISOString(),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})
