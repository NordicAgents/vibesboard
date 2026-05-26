'use client'

import type { UseChatHelpers } from 'ai/react'

export function EmptyScreen({ setInput }: Pick<UseChatHelpers, 'setInput'>) {
  // Intentionally minimal empty state for a clean landing.
  return <div />
}
