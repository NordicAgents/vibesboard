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

