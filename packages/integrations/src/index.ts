// @vibesboard/integrations — registry of third-party integrations
// (Embed Widget, WhatsApp Inbox, Instagram Inbox, Chatwoot, Google
// Calendar, Google Sheets, etc.) and tiny helper lookups.
//
// Pure data + thin filters — no I/O. The actual integration *runtime*
// lives elsewhere (the channel-* packages, scheduling, data). This
// package just owns the metadata that the UI and API surface need.

export * from './registry.ts'
export * from './helpers.ts'
export * from './types.ts'
