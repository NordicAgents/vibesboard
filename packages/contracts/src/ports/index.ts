// Port interfaces — the "API" between feature packages and adapter packages.
//
// These are deliberately small skeletons in Phase 1. Each adapter phase
// (Firebase, OpenAI, Anthropic, Google, Stripe, channel-*) fleshes out the
// methods it needs, defined by what current code actually calls. See spec §5.

export type { IDataStore } from './data-store'
export type { IAuth } from './auth'
export type { IStorage } from './storage'
export type { IAIProvider } from './ai-provider'
export type { ICalendarProvider } from './calendar-provider'
export type { IBilling } from './billing'
export type { IInboxChannel } from './inbox-channel'
