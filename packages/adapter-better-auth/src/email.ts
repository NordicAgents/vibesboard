import { Resend } from 'resend'

const FROM = process.env.NOTIFICATION_EMAIL_FROM ?? 'Vibesboard <noreply@example.com>'

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  return new Resend(key)
}

/**
 * Dev-only fallback when RESEND_API_KEY is unset: log the link so local sign-in
 * works without an email provider. In production this is a security hazard —
 * the URL carries a single-use auth token and would land in application logs —
 * so refuse loudly instead, surfacing the misconfiguration rather than silently
 * "succeeding" with an email that was never sent.
 */
function logDevFallbackOrThrow(label: string, recipient: string, url: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `[adapter-better-auth] RESEND_API_KEY is not configured; refusing to send ${label} in production`
    )
  }
  console.log(`[adapter-better-auth] ${label} (dev fallback) for ${recipient}: ${url}`)
}

export async function sendMagicLinkEmail({ email, url }: { email: string; url: string }): Promise<void> {
  const resend = getResend()
  if (!resend) {
    logDevFallbackOrThrow('Magic link', email, url)
    return
  }
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Sign in to Vibesboard',
    html: `<p>Click to sign in: <a href="${url}">${url}</a></p>`,
  })
}

export async function sendVerifyEmail({
  user,
  url,
}: {
  user: { email: string }
  url: string
}): Promise<void> {
  const resend = getResend()
  if (!resend) {
    logDevFallbackOrThrow('Verify email', user.email, url)
    return
  }
  await resend.emails.send({
    from: FROM,
    to: user.email,
    subject: 'Verify your email',
    html: `<p>Verify your email: <a href="${url}">${url}</a></p>`,
  })
}

export async function sendResetPasswordEmail({
  user,
  url,
}: {
  user: { email: string }
  url: string
}): Promise<void> {
  const resend = getResend()
  if (!resend) {
    logDevFallbackOrThrow('Reset password', user.email, url)
    return
  }
  await resend.emails.send({
    from: FROM,
    to: user.email,
    subject: 'Reset your Vibesboard password',
    html: `<p>Reset your password: <a href="${url}">${url}</a></p>`,
  })
}
