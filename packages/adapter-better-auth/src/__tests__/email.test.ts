import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// resend is stubbed so no real email ever goes out. A single shared send spy
// is asserted across the configured-key cases.
// Shape of the payload passed to resend `emails.send`; the mock's inferred call
// type is an empty tuple, so we cast through this for type-safe assertions.
type EmailPayload = { from: string; to: string; subject: string; html: string };

const sendMock = vi.fn(async () => ({ data: { id: 'mock-message-id' }, error: null }));
const ctorMock = vi.fn();

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
    constructor(apiKey?: string) {
      ctorMock(apiKey);
    }
  },
}));

import {
  sendMagicLinkEmail,
  sendVerifyEmail,
  sendResetPasswordEmail,
} from '../email.ts';

const ENV_KEYS = ['RESEND_API_KEY', 'NOTIFICATION_EMAIL_FROM'] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  sendMock.mockClear();
  ctorMock.mockClear();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
});

describe('sendMagicLinkEmail', () => {
  it('sends via Resend with the default FROM when RESEND_API_KEY is set', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    delete process.env.NOTIFICATION_EMAIL_FROM;

    await sendMagicLinkEmail({ email: 'user@example.com', url: 'https://app/link?t=abc' });

    expect(ctorMock).toHaveBeenCalledWith('test-key');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [payload] = sendMock.mock.calls[0] as unknown as [EmailPayload];
    expect(payload.from).toBe('Vibesboard <noreply@example.com>');
    expect(payload.to).toBe('user@example.com');
    expect(payload.subject).toBe('Sign in to Vibesboard');
    expect(payload.html).toContain('https://app/link?t=abc');
  });

  it('no-ops (no send) when RESEND_API_KEY is unset (dev fallback)', async () => {
    delete process.env.RESEND_API_KEY;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(
        sendMagicLinkEmail({ email: 'skip@example.com', url: 'https://app/link' }),
      ).resolves.toBeUndefined();
      expect(sendMock).not.toHaveBeenCalled();
      expect(ctorMock).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toContain('skip@example.com');
      expect(log.mock.calls[0][0]).toContain('Magic link');
    } finally {
      log.mockRestore();
    }
  });

  it('propagates errors thrown by the Resend client', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    sendMock.mockRejectedValueOnce(new Error('resend-down'));
    await expect(
      sendMagicLinkEmail({ email: 'user@example.com', url: 'https://app/link' }),
    ).rejects.toThrow(/resend-down/);
  });
});

describe('sendVerifyEmail', () => {
  it('sends a verification email addressed to the user', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    delete process.env.NOTIFICATION_EMAIL_FROM;

    await sendVerifyEmail({ user: { email: 'verify@example.com' }, url: 'https://app/verify' });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [payload] = sendMock.mock.calls[0] as unknown as [EmailPayload];
    expect(payload.to).toBe('verify@example.com');
    expect(payload.subject).toBe('Verify your email');
    expect(payload.html).toContain('https://app/verify');
  });

  it('no-ops when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(
        sendVerifyEmail({ user: { email: 'skip@example.com' }, url: 'https://app/verify' }),
      ).resolves.toBeUndefined();
      expect(sendMock).not.toHaveBeenCalled();
      expect(log.mock.calls[0][0]).toContain('Verify email');
      expect(log.mock.calls[0][0]).toContain('skip@example.com');
    } finally {
      log.mockRestore();
    }
  });
});

describe('sendResetPasswordEmail', () => {
  it('sends a reset email addressed to the user', async () => {
    process.env.RESEND_API_KEY = 'test-key';

    await sendResetPasswordEmail({ user: { email: 'reset@example.com' }, url: 'https://app/reset' });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [payload] = sendMock.mock.calls[0] as unknown as [EmailPayload];
    expect(payload.to).toBe('reset@example.com');
    expect(payload.subject).toBe('Reset your Vibesboard password');
    expect(payload.html).toContain('https://app/reset');
  });

  it('no-ops when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(
        sendResetPasswordEmail({ user: { email: 'skip@example.com' }, url: 'https://app/reset' }),
      ).resolves.toBeUndefined();
      expect(sendMock).not.toHaveBeenCalled();
      expect(log.mock.calls[0][0]).toContain('Reset password');
    } finally {
      log.mockRestore();
    }
  });

  it('propagates errors thrown by the Resend client', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    sendMock.mockRejectedValueOnce(new Error('reset-fail'));
    await expect(
      sendResetPasswordEmail({ user: { email: 'user@example.com' }, url: 'https://app/reset' }),
    ).rejects.toThrow(/reset-fail/);
  });
});
