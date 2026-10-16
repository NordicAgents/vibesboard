// @vitest-environment jsdom

import * as React from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SWRConfig } from 'swr'
import type { VibeAgent } from '@vibesboard/contracts'

import { AgentAskChat } from './agent-ask-chat'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}))
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }))
vi.mock('@/components/chat-scroll-anchor', () => ({
  ChatScrollAnchor: () => null
}))
vi.mock('@/components/chat-list', () => ({
  ChatList: ({
    messages
  }: {
    messages: Array<{ id: string; content: string }>
  }) => messages.map(message => <p key={message.id}>{message.content}</p>)
}))
vi.mock('@/components/prompt-form', () => ({
  PromptForm: ({
    input,
    setInput,
    onSubmit
  }: {
    input: string
    setInput: (value: string) => void
    onSubmit: (value: string) => Promise<void>
  }) => (
    <form
      onSubmit={event => {
        event.preventDefault()
        void onSubmit(input)
      }}
    >
      <input
        aria-label="Question"
        value={input}
        onChange={event => setInput(event.target.value)}
      />
      <button type="submit">Send</button>
    </form>
  )
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AgentAskChat with the installed completion SDK', () => {
  it('uses the response session ID for a follow-up and keeps both completed replies', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValueOnce(
      new Response('First answer', { headers: { 'x-session-id': 'session-1' } })
    )
    fetchMock.mockResolvedValueOnce(
      new Response('Second answer', {
        headers: { 'x-session-id': 'session-1' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <AgentAskChat
          agent={{ id: 'agent-1' } as VibeAgent}
          ownerId="owner-1"
          ownerSessions={[]}
        />
      </SWRConfig>
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), {
      target: { value: 'First question' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('First answer')

    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), {
      target: { value: 'Follow-up question' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const followUp = JSON.parse(fetchMock.mock.calls[1][1]?.body as string)
    expect(followUp).toEqual({
      prompt: 'Follow-up question',
      sessionId: 'session-1'
    })
    await screen.findByText('Second answer')
    expect(screen.getAllByText('First answer')).toHaveLength(1)
    expect(screen.getAllByText('Second answer')).toHaveLength(1)
  })
})
