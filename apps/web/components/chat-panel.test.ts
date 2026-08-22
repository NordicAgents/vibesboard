import { describe, expect, it } from 'vitest'

import { shouldShowChatCompletion } from './chat-panel'

describe('shouldShowChatCompletion', () => {
  it('keeps the provider composer available after a completed reply', () => {
    expect(
      shouldShowChatCompletion({
        isChatComplete: true,
        isLoading: false,
        agentMode: 'provider'
      })
    ).toBe(false)
  })

  it('shows the completion state for collector agents', () => {
    expect(
      shouldShowChatCompletion({
        isChatComplete: true,
        isLoading: false,
        agentMode: 'collector'
      })
    ).toBe(true)
  })

  it('still shows a disabled banner when the agent response limit is reached', () => {
    expect(
      shouldShowChatCompletion({
        isChatComplete: false,
        isAgentDisabled: true,
        isLoading: false,
        agentMode: 'provider'
      })
    ).toBe(true)
  })

  it('keeps the composer visible while a reply is streaming', () => {
    expect(
      shouldShowChatCompletion({
        isChatComplete: true,
        isAgentDisabled: true,
        isLoading: true,
        agentMode: 'collector'
      })
    ).toBe(false)
  })
})
