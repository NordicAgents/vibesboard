import { it, expect } from 'vitest'
import { getBookingResourceConnectionPrompt } from './booking-resource-setup.ts'

it('getBookingResourceConnectionPrompt asks to connect Google Calendar when no connections exist', () => {
  const prompt = getBookingResourceConnectionPrompt({
    loadingConnections: false,
    activeConnectionCount: 0,
    totalConnectionCount: 0
  })

  expect(prompt.showConnectAction).toBe(true)
  expect(prompt.message).toMatch(/Connect Google Calendar/)
})

it('getBookingResourceConnectionPrompt asks to reconnect when only inactive connections exist', () => {
  const prompt = getBookingResourceConnectionPrompt({
    loadingConnections: false,
    activeConnectionCount: 0,
    totalConnectionCount: 2
  })

  expect(prompt.showConnectAction).toBe(true)
  expect(prompt.message).toMatch(/No active Google Calendar connections/)
})

it('getBookingResourceConnectionPrompt hides setup prompt while usable connections exist', () => {
  const prompt = getBookingResourceConnectionPrompt({
    loadingConnections: false,
    activeConnectionCount: 1,
    totalConnectionCount: 1
  })

  expect(prompt.showConnectAction).toBe(false)
  expect(prompt.message).toBe('')
})

it('getBookingResourceConnectionPrompt stays quiet while connections are still loading', () => {
  const prompt = getBookingResourceConnectionPrompt({
    loadingConnections: true,
    activeConnectionCount: 0,
    totalConnectionCount: 0
  })

  expect(prompt.showConnectAction).toBe(false)
  expect(prompt.message).toBe('')
})
