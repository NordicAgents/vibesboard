import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BookingEnquiryDocument, VibeAgent } from '@vibesboard/contracts'

// Stub the `resend` package so no real email is sent. notify.ts does a dynamic
// `import('resend')` and calls `new Resend(apiKey).emails.send(...)`.
const sendMock = vi.fn(async () => ({ data: { id: 'stub' }, error: null }))
const resendCtor = vi.fn()
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock }
    constructor(apiKey: string) {
      resendCtor(apiKey)
    }
  },
}))

import { notifyAdminOfEnquiry } from './notify.ts'

function makeEnquiry(
  overrides: Partial<BookingEnquiryDocument> = {},
): BookingEnquiryDocument {
  return {
    id: 'enq-1',
    agentId: 'agent-1',
    tenantId: 'tenant-1',
    resourceName: 'Glass Cabin',
    calendarId: 'cal-1',
    calendarName: 'Cabins',
    timezone: 'Europe/Stockholm',
    startDatetime: '2026-05-10T14:00',
    endDatetime: '2026-05-12T11:00',
    guestName: 'Jane Doe',
    guestEmail: 'jane@example.com',
    guestPhone: '+46 70 000 00 00',
    guestCount: 2,
    notes: 'Late check-in',
    createdAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

type NotificationConfig = NonNullable<VibeAgent['notificationConfig']>

// The function under test only reads `id`, `userId`, and `notificationConfig`,
// so these minimal fixtures deliberately omit the other required VibeAgent
// fields and are cast to the full type.
function makeAgent(overrides: Partial<VibeAgent> = {}): VibeAgent {
  return { id: 'agent-1', name: 'Agent', ...overrides } as VibeAgent
}

// notifyAdminOfEnquiry only reads `notificationConfig.email`, so the tests pass
// a partial config exercising just that branch; widen it to the full type.
function notifConfig(
  partial: Partial<NotificationConfig>,
): NotificationConfig {
  return partial as NotificationConfig
}

const ORIGINAL_KEY = process.env.RESEND_API_KEY
const ORIGINAL_FROM = process.env.NOTIFICATION_EMAIL_FROM

describe('notifyAdminOfEnquiry', () => {
  beforeEach(() => {
    sendMock.mockClear()
    resendCtor.mockClear()
    process.env.RESEND_API_KEY = 'test-resend-key'
  })

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = ORIGINAL_KEY
    if (ORIGINAL_FROM === undefined) delete process.env.NOTIFICATION_EMAIL_FROM
    else process.env.NOTIFICATION_EMAIL_FROM = ORIGINAL_FROM
  })

  it('skips sending when RESEND_API_KEY is not set', async () => {
    delete process.env.RESEND_API_KEY
    await notifyAdminOfEnquiry(
      makeAgent({
        notificationConfig: notifConfig({ email: { enabled: true, address: 'owner@x.com' } }),
      }),
      makeEnquiry(),
    )
    expect(sendMock).not.toHaveBeenCalled()
    expect(resendCtor).not.toHaveBeenCalled()
  })

  it('skips sending when no admin address can be resolved', async () => {
    // No notificationConfig and no userId — nothing to resolve to.
    await notifyAdminOfEnquiry(makeAgent(), makeEnquiry())
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('skips when notificationConfig email is disabled and there is no userId', async () => {
    await notifyAdminOfEnquiry(
      makeAgent({
        notificationConfig: notifConfig({ email: { enabled: false, address: 'owner@x.com' } }),
      }),
      makeEnquiry(),
    )
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('sends to the notificationConfig address when enabled', async () => {
    await notifyAdminOfEnquiry(
      makeAgent({
        notificationConfig: notifConfig({ email: { enabled: true, address: 'owner@x.com' } }),
      }),
      makeEnquiry(),
    )
    expect(resendCtor).toHaveBeenCalledWith('test-resend-key')
    expect(sendMock).toHaveBeenCalledTimes(1)
    const arg = (sendMock.mock.calls[0] as unknown as unknown[])[0] as Record<string, unknown>
    expect(arg.to).toBe('owner@x.com')
  })

  it('builds a subject from the resource name', async () => {
    await notifyAdminOfEnquiry(
      makeAgent({
        notificationConfig: notifConfig({ email: { enabled: true, address: 'owner@x.com' } }),
      }),
      makeEnquiry({ resourceName: 'Lake House' }),
    )
    const arg = (sendMock.mock.calls[0] as unknown as unknown[])[0] as Record<string, unknown>
    expect(arg.subject).toBe('New booking enquiry — Lake House')
  })

  it('includes guest details and notes in the email body', async () => {
    await notifyAdminOfEnquiry(
      makeAgent({
        notificationConfig: notifConfig({ email: { enabled: true, address: 'owner@x.com' } }),
      }),
      makeEnquiry(),
    )
    const arg = (sendMock.mock.calls[0] as unknown as unknown[])[0] as Record<string, string>
    expect(arg.text).toContain('Guest: Jane Doe')
    expect(arg.text).toContain('Email: jane@example.com')
    expect(arg.text).toContain('Phone: +46 70 000 00 00')
    expect(arg.text).toContain('Guests: 2')
    expect(arg.text).toContain('Notes: Late check-in')
    expect(arg.text).toContain('Resource: Glass Cabin')
  })

  it('omits the optional Guests/Notes lines when absent', async () => {
    await notifyAdminOfEnquiry(
      makeAgent({
        notificationConfig: notifConfig({ email: { enabled: true, address: 'owner@x.com' } }),
      }),
      makeEnquiry({ guestCount: undefined, notes: undefined }),
    )
    const arg = (sendMock.mock.calls[0] as unknown as unknown[])[0] as Record<string, string>
    expect(arg.text).not.toContain('Guests:')
    expect(arg.text).not.toContain('Notes:')
  })

  it('attaches a base64 .ics calendar invite', async () => {
    await notifyAdminOfEnquiry(
      makeAgent({
        notificationConfig: notifConfig({ email: { enabled: true, address: 'owner@x.com' } }),
      }),
      makeEnquiry(),
    )
    const arg = (sendMock.mock.calls[0] as unknown as unknown[])[0] as {
      attachments: { filename: string; content: string; contentType: string }[]
    }
    expect(arg.attachments).toHaveLength(1)
    const att = arg.attachments[0]
    expect(att.filename).toBe('booking-enq-1.ics')
    expect(att.contentType).toContain('text/calendar')
    // Decode the base64 attachment and confirm it is a real VCALENDAR.
    const decoded = Buffer.from(att.content, 'base64').toString('utf8')
    expect(decoded.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(decoded).toContain('UID:enq-1@vibeagent')
    expect(decoded).toContain('ORGANIZER:mailto:owner@x.com')
  })

  it('uses the configured NOTIFICATION_EMAIL_FROM when set', async () => {
    process.env.NOTIFICATION_EMAIL_FROM = 'Resort <hello@resort.com>'
    await notifyAdminOfEnquiry(
      makeAgent({
        notificationConfig: notifConfig({ email: { enabled: true, address: 'owner@x.com' } }),
      }),
      makeEnquiry(),
    )
    const arg = (sendMock.mock.calls[0] as unknown as unknown[])[0] as Record<string, unknown>
    expect(arg.from).toBe('Resort <hello@resort.com>')
  })

  it('falls back to the default sender when NOTIFICATION_EMAIL_FROM is unset', async () => {
    delete process.env.NOTIFICATION_EMAIL_FROM
    await notifyAdminOfEnquiry(
      makeAgent({
        notificationConfig: notifConfig({ email: { enabled: true, address: 'owner@x.com' } }),
      }),
      makeEnquiry(),
    )
    const arg = (sendMock.mock.calls[0] as unknown as unknown[])[0] as Record<string, unknown>
    expect(arg.from).toBe('VibeAgent <notifications@vibeagent.com>')
  })
})
