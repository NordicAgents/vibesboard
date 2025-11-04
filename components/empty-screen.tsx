import { UseChatHelpers } from 'ai/react'

export function EmptyScreen(_: Pick<UseChatHelpers, 'setInput'>) {
  // Intentionally minimal empty state for a clean landing.
  return <div />
}
