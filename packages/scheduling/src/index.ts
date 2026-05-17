// @vibesboard/scheduling — calendar connections, OAuth flow, provider
// abstraction for Google Calendar (and future Cal.com etc.) bookings.
//
// Used by:
//   - apps/web/app/api/scheduling/** (HTTP routes for OAuth + connections)
//   - apps/web/components/agents/agent-{scheduling,booking-resource,calendar-
//     availability}-settings.tsx (build auth URLs)
//   - apps/web/lib/agent/actions/{appointments,booking}/tools.ts (agent tools
//     check availability + create events through createProvider())
//
// Subpath export ./providers exposes the SchedulingProvider interface and
// the Google implementation for code that wants only that surface.

export * from './connections.ts'
export * from './google-auth.ts'
export * from './oauth-return.ts'
export * from './providers/index.ts'
