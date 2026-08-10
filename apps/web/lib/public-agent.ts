/** Final response-boundary guard for agent access-gate secrets. */
export function toPublicAgentResponse<T extends object>(
  agent: T
): Omit<T, 'accessPassword' | 'accessPasswordHash'> {
  const safeAgent = { ...agent } as Record<string, unknown>
  delete safeAgent.accessPassword
  delete safeAgent.accessPasswordHash
  return safeAgent as Omit<T, 'accessPassword' | 'accessPasswordHash'>
}
