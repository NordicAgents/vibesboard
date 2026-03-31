/**
 * Pure rollup field-building functions extracted from usage.ts for testability.
 * These have no Firestore or server-only dependencies.
 */

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
  const { source, agentId, model, userId, inputTokens, outputTokens, incrementFn } = params
  const userKey = userId ?? '_anonymous'

  return {
    totalMessages: incrementFn(1),
    totalInputTokens: incrementFn(inputTokens),
    totalOutputTokens: incrementFn(outputTokens),
    [`bySource.${source}`]: incrementFn(1),
    [`byAgent.${agentId}`]: incrementFn(1),
    [`byModel.${model}`]: incrementFn(1),
    [`byUser.${userKey}.messages`]: incrementFn(1),
    [`byUser.${userKey}.inputTokens`]: incrementFn(inputTokens),
    [`byUser.${userKey}.outputTokens`]: incrementFn(outputTokens),
    [`byUser.${userKey}.byAgent.${agentId}.messages`]: incrementFn(1),
    [`byUser.${userKey}.byAgent.${agentId}.inputTokens`]: incrementFn(inputTokens),
    [`byUser.${userKey}.byAgent.${agentId}.outputTokens`]: incrementFn(outputTokens),
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
  const { tenantId, billingCycleId, source, agentId, model, userId, inputTokens, outputTokens, incrementFn } = params
  const userKey = userId ?? '_anonymous'

  return {
    tenantId,
    billingCycleId,
    totalMessages: incrementFn(1),
    totalInputTokens: incrementFn(inputTokens),
    totalOutputTokens: incrementFn(outputTokens),
    bySource: { [source]: incrementFn(1) },
    byAgent: { [agentId]: incrementFn(1) },
    byModel: { [model]: incrementFn(1) },
    byUser: {
      [userKey]: {
        messages: incrementFn(1),
        inputTokens: incrementFn(inputTokens),
        outputTokens: incrementFn(outputTokens),
        byAgent: {
          [agentId]: {
            messages: incrementFn(1),
            inputTokens: incrementFn(inputTokens),
            outputTokens: incrementFn(outputTokens),
          }
        }
      }
    },
  }
}
