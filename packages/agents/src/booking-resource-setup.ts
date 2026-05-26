interface BookingResourceConnectionPromptInput {
  loadingConnections: boolean
  activeConnectionCount: number
  totalConnectionCount: number
}

interface BookingResourceConnectionPrompt {
  showConnectAction: boolean
  message: string
}

export function getBookingResourceConnectionPrompt({
  loadingConnections,
  activeConnectionCount,
  totalConnectionCount
}: BookingResourceConnectionPromptInput): BookingResourceConnectionPrompt {
  if (loadingConnections || activeConnectionCount > 0) {
    return { showConnectAction: false, message: '' }
  }

  if (totalConnectionCount > 0) {
    return {
      showConnectAction: true,
      message:
        'No active Google Calendar connections are available. Reconnect Google Calendar before adding a bookable resource.'
    }
  }

  return {
    showConnectAction: true,
    message:
      'Connect Google Calendar first, then choose the room calendar for this resource.'
  }
}
