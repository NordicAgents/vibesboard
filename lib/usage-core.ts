/**
 * Pure rollup field-building functions extracted from usage.ts for testability.
 * These have no Firestore or server-only dependencies.
 */

/** Sanitize a value used in Firestore dot-notation field paths.
 *  Dots are path separators in Firestore update() calls, so they must be
 *  replaced to prevent unintended nesting from user-controlled input. */
function sanitizeFieldKey(value: string): string {
  return value.replace(/\./g, '_')
}

/** Coerce a token count to a finite non-negative integer.
 *  Guards against NaN/Infinity reaching FieldValue.increment(), which
 *  throws synchronously on non-finite values and would tear down a
 *  streaming response. Negative values are also clamped to 0. */
export function coerceTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0
}

export interface RollupUpdateFields {
  [key: string]: any
}

/**
 * Build the dot-notation field map for the rollup update() call.
 * Pure function — no Firestore dependency.
 */
export function buildRollupUpdateFields(params: {
  source: string
  agentId: string
  model: string
  userId: string | null
  inputTokens: number
  outputTokens: number
  incrementFn: (n: number) => any
}): RollupUpdateFields {
  const {
    source,
    agentId,
    model,
    userId,
    inputTokens,
    outputTokens,
    incrementFn
  } = params
  const userKey = sanitizeFieldKey(userId ?? '_anonymous')
  const safeAgentId = sanitizeFieldKey(agentId)

  return {
    totalMessages: incrementFn(1),
    totalInputTokens: incrementFn(inputTokens),
    totalOutputTokens: incrementFn(outputTokens),
    [`bySource.${source}`]: incrementFn(1),
    [`byAgent.${safeAgentId}`]: incrementFn(1),
    [`byModel.${model}`]: incrementFn(1),
    [`byUser.${userKey}.messages`]: incrementFn(1),
    [`byUser.${userKey}.inputTokens`]: incrementFn(inputTokens),
    [`byUser.${userKey}.outputTokens`]: incrementFn(outputTokens),
    [`byUser.${userKey}.byAgent.${safeAgentId}.messages`]: incrementFn(1),
    [`byUser.${userKey}.byAgent.${safeAgentId}.inputTokens`]:
      incrementFn(inputTokens),
    [`byUser.${userKey}.byAgent.${safeAgentId}.outputTokens`]:
      incrementFn(outputTokens)
  }
}

/**
 * Build the nested structure for the rollup set() fallback.
 * Pure function — no Firestore dependency.
 */
export function buildRollupSetFields(params: {
  tenantId: string
  billingCycleId: string
  source: string
  agentId: string
  model: string
  userId: string | null
  inputTokens: number
  outputTokens: number
  incrementFn: (n: number) => any
}): Record<string, any> {
  const {
    tenantId,
    billingCycleId,
    source,
    agentId,
    model,
    userId,
    inputTokens,
    outputTokens,
    incrementFn
  } = params
  const userKey = sanitizeFieldKey(userId ?? '_anonymous')
  const safeAgentId = sanitizeFieldKey(agentId)

  return {
    tenantId,
    billingCycleId,
    totalMessages: incrementFn(1),
    totalInputTokens: incrementFn(inputTokens),
    totalOutputTokens: incrementFn(outputTokens),
    bySource: { [source]: incrementFn(1) },
    byAgent: { [safeAgentId]: incrementFn(1) },
    byModel: { [model]: incrementFn(1) },
    byUser: {
      [userKey]: {
        messages: incrementFn(1),
        inputTokens: incrementFn(inputTokens),
        outputTokens: incrementFn(outputTokens),
        byAgent: {
          [safeAgentId]: {
            messages: incrementFn(1),
            inputTokens: incrementFn(inputTokens),
            outputTokens: incrementFn(outputTokens)
          }
        }
      }
    }
  }
}
