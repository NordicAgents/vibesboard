// Port interfaces — the "API" between feature packages and adapter packages.
//
// These are deliberately small skeletons in Phase 1. Each adapter phase
// (Firebase, OpenAI, Anthropic, Google, Stripe, channel-*) fleshes out the
// methods it needs, defined by what current code actually calls. See spec §5.

export type { IDataStore } from './data-store.ts'
export type { IAuth } from './auth.ts'
export type { IStorage } from './storage.ts'
export type { IAIProvider } from './ai-provider.ts'
export type { ICalendarProvider } from './calendar-provider.ts'
export type { IBilling } from './billing.ts'
export type { IInboxChannel } from './inbox-channel.ts'
