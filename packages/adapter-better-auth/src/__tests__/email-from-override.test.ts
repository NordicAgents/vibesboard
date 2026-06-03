// email.ts reads its `FROM` address ONCE at module-load time:
//   const FROM = process.env.NOTIFICATION_EMAIL_FROM ?? 'Vibesboard <noreply@example.com>'
// To exercise the override deterministically, the env var must be set BEFORE
// email.ts is evaluated. This lives in its own spec file (and imports email.ts
// dynamically inside the test, after setting the env var) so a static import in
// the shared email.test.ts cannot capture the default first.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

const sendMock = vi.fn(async () => ({ data: { id: 'mock-message-id' }, error: null }));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
    constructor(public apiKey?: string) {}
  },
}));

let savedFrom: string | undefined;
let savedKey: string | undefined;

beforeAll(() => {
  savedFrom = process.env.NOTIFICATION_EMAIL_FROM;
  savedKey = process.env.RESEND_API_KEY;
  process.env.NOTIFICATION_EMAIL_FROM = 'Acme <noreply@acme.test>';
  process.env.RESEND_API_KEY = 'test-key';
});

afterAll(() => {
  if (savedFrom === undefined) delete process.env.NOTIFICATION_EMAIL_FROM;
  else process.env.NOTIFICATION_EMAIL_FROM = savedFrom;
  if (savedKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = savedKey;
});

describe('email FROM override (NOTIFICATION_EMAIL_FROM)', () => {
  it('uses NOTIFICATION_EMAIL_FROM as the sender when set at module load', async () => {
    sendMock.mockClear();
    vi.resetModules();
    // Imported here (not statically at top) so the env var above is already in
    // place when email.ts evaluates its module-level FROM constant.
    const { sendVerifyEmail } = await import('../email.ts');

    await sendVerifyEmail({ user: { email: 'verify@example.com' }, url: 'https://app/verify' });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [payload] = sendMock.mock.calls[0] as unknown as [{ from: string }];
    expect(payload.from).toBe('Acme <noreply@acme.test>');
  });
});
