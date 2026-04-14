export function maskEmail(email: string | null | undefined): string {
  const value = (email ?? '').trim()
  const atIndex = value.indexOf('@')
  if (atIndex <= 0 || atIndex === value.length - 1) {
    return '***'
  }

  const local = value.slice(0, atIndex)
  const domain = value.slice(atIndex + 1)

  const [domainLabel, ...rest] = domain.split('.')
  const tld = rest.length ? `.${rest.join('.')}` : ''

  const maskedLocal =
    local.length === 1 ? `${local}***` : `${local.slice(0, 1)}***`
  const maskedDomain =
    domainLabel.length === 1
      ? `${domainLabel}***`
      : `${domainLabel.slice(0, 1)}***`

  return `${maskedLocal}@${maskedDomain}${tld}`
}

// ─── Invitation Email ───────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface InvitationEmailParams {
  to: string
  inviteUrl: string
  tenantName: string
  inviterName: string
  role: string
}

/**
 * Send an invitation email. Returns a promise that resolves when sent.
 * Errors are logged and swallowed so callers don't need try/catch.
 */
export async function sendInvitationEmail(
  params: InvitationEmailParams
): Promise<void> {
  try {
    await _sendInvitationEmailAsync(params)
  } catch (err) {
    console.error('[email] Invitation email failed:', err)
  }
}

function formatRole(role: string): string {
  switch (role) {
    case 'TENANT_ADMIN':
      return 'Admin'
    case 'MEMBER':
      return 'Member'
    default:
      return role
  }
}

async function _sendInvitationEmailAsync(
  params: InvitationEmailParams
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn(
      '[email] RESEND_API_KEY not configured, skipping invitation email'
    )
    return
  }

  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)

  const { to, inviteUrl, tenantName, inviterName } = params
  const role = formatRole(params.role)

  const subject = `You're invited to join ${tenantName} on VibeAgent`

  const text = [
    `You've been invited to join ${tenantName} on VibeAgent!`,
    '',
    `${inviterName} invited you to join ${tenantName} as a ${role}.`,
    '',
    'Accept the invitation by visiting:',
    inviteUrl,
    '',
    'This invitation will expire in 7 days.',
    '',
    "If you didn't expect this invitation, you can safely ignore this email."
  ].join('\n')

  const safeInviterName = escapeHtml(inviterName)
  const safeTenantName = escapeHtml(tenantName)
  const safeRole = escapeHtml(role)
  const safeInviteUrl = encodeURI(inviteUrl)

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#F5F0E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#FDFAF5;border-radius:16px;border:1px solid #E2DDD4;overflow:hidden;">
        <tr><td style="padding:40px 40px 24px;">
          <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1A1915;">You're invited!</h1>
          <p style="margin:0;font-size:16px;line-height:24px;color:#6B6560;">
            <strong style="color:#1A1915;">${safeInviterName}</strong> invited you to join
            <strong style="color:#1A1915;">${safeTenantName}</strong> as a <strong style="color:#1A1915;">${safeRole}</strong>.
          </p>
        </td></tr>
        <tr><td style="padding:0 40px 32px;" align="center">
          <a href="${safeInviteUrl}" style="display:inline-block;padding:12px 32px;background-color:#D97757;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;border-radius:8px;">
            Accept Invitation
          </a>
        </td></tr>
        <tr><td style="padding:0 40px 32px;">
          <p style="margin:0 0 4px;font-size:13px;color:#9D9790;">Or copy this link:</p>
          <p style="margin:0;font-size:13px;color:#6B6560;word-break:break-all;">${safeInviteUrl}</p>
        </td></tr>
        <tr><td style="padding:16px 40px;border-top:1px solid #E2DDD4;">
          <p style="margin:0;font-size:12px;color:#9D9790;">
            This invitation will expire in 7 days.
            If you didn't expect this, you can safely ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  await resend.emails.send({
    from:
      process.env.NOTIFICATION_EMAIL_FROM ||
      'VibeAgent <notifications@vibeagent.com>',
    to,
    subject,
    html,
    text
  })
}
