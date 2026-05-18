import { Resend } from 'resend'

const FROM = process.env.NOTIFICATION_EMAIL_FROM ?? 'Vibesboard <noreply@example.com>'

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  return new Resend(key)
}

export async function sendMagicLinkEmail({ email, url }: { email: string; url: string }): Promise<void> {
  const resend = getResend()
  if (!resend) {
    console.log(`[adapter-better-auth] Magic link (dev fallback) for ${email}: ${url}`)
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
    console.log(`[adapter-better-auth] Verify email (dev fallback) for ${user.email}: ${url}`)
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
    console.log(`[adapter-better-auth] Reset password (dev fallback) for ${user.email}: ${url}`)
    return
  }
  await resend.emails.send({
    from: FROM,
    to: user.email,
    subject: 'Reset your Vibesboard password',
    html: `<p>Reset your password: <a href="${url}">${url}</a></p>`,
  })
}
