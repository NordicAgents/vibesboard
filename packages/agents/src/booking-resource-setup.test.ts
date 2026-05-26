import test from 'node:test'
import assert from 'node:assert/strict'
import { getBookingResourceConnectionPrompt } from './booking-resource-setup.ts'

test('getBookingResourceConnectionPrompt asks to connect Google Calendar when no connections exist', () => {
  const prompt = getBookingResourceConnectionPrompt({
    loadingConnections: false,
    activeConnectionCount: 0,
    totalConnectionCount: 0
  })

  assert.equal(prompt.showConnectAction, true)
  assert.match(prompt.message, /Connect Google Calendar/)
})

test('getBookingResourceConnectionPrompt asks to reconnect when only inactive connections exist', () => {
  const prompt = getBookingResourceConnectionPrompt({
    loadingConnections: false,
    activeConnectionCount: 0,
    totalConnectionCount: 2
  })

  assert.equal(prompt.showConnectAction, true)
  assert.match(prompt.message, /No active Google Calendar connections/)
})

test('getBookingResourceConnectionPrompt hides setup prompt while usable connections exist', () => {
  const prompt = getBookingResourceConnectionPrompt({
    loadingConnections: false,
    activeConnectionCount: 1,
    totalConnectionCount: 1
  })

  assert.equal(prompt.showConnectAction, false)
  assert.equal(prompt.message, '')
})
