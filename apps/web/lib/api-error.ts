interface ValidationIssue {
  path?: unknown
  message?: unknown
}

interface ApiErrorPayload {
  error?: unknown
  issues?: unknown
}

export function getApiErrorMessage(
  payload: ApiErrorPayload,
  fallback: string
): string {
  const summary =
    typeof payload?.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : fallback
  const issues = Array.isArray(payload?.issues)
    ? (payload.issues as ValidationIssue[])
        .map(issue => {
          const path = Array.isArray(issue?.path)
            ? issue.path.map(String).join('.')
            : ''
          const message =
            typeof issue?.message === 'string' ? issue.message.trim() : ''
          if (!message) return null
          return path ? `${path}: ${message}` : message
        })
        .filter((issue): issue is string => Boolean(issue))
    : []

  return issues.length ? `${summary} — ${issues.join('; ')}` : summary
}
