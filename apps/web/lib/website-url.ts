/**
 * Extract website addresses a user has typed, accepting both full URLs and
 * the common bare-domain form (for example, `example.com`).
 */
export function extractWebsiteUrls(value: string): string[] {
  const urls = new Set<string>()

  for (const rawToken of value.split(/\s+/)) {
    const candidate = cleanUrlToken(rawToken)
    if (!candidate) continue

    const lowerCandidate = candidate.toLocaleLowerCase()
    const httpIndex = lowerCandidate.indexOf('http://')
    const httpsIndex = lowerCandidate.indexOf('https://')
    const schemeIndex =
      httpIndex === -1
        ? httpsIndex
        : httpsIndex === -1
          ? httpIndex
          : Math.min(httpIndex, httpsIndex)
    const explicitCandidate =
      schemeIndex >= 0 ? candidate.slice(schemeIndex) : candidate
    const hasHttpScheme = schemeIndex >= 0
    const normalized = hasHttpScheme
      ? explicitCandidate
      : `https://${explicitCandidate}`

    try {
      const url = new URL(normalized)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      if (!hasHttpScheme && !isBareDomain(url.hostname, explicitCandidate)) {
        continue
      }
      urls.add(url.toString().replace(/\/$/, ''))
    } catch {
      // Ignore tokens that are not valid URLs.
    }
  }

  return [...urls]
}

const LEADING_URL_PUNCTUATION = new Set(['(', '[', '{', '<', '"', "'"])
const TRAILING_URL_PUNCTUATION = new Set([
  '.',
  ',',
  '!',
  '?',
  ';',
  ':',
  ')',
  ']',
  '}',
  '>',
  '"',
  "'"
])

function cleanUrlToken(token: string): string {
  let start = 0
  let end = token.length

  while (start < end && LEADING_URL_PUNCTUATION.has(token[start])) start++
  while (end > start && TRAILING_URL_PUNCTUATION.has(token[end - 1])) end--

  return token.slice(start, end)
}

function isBareDomain(hostname: string, originalToken: string): boolean {
  if (originalToken.includes('@') || !hostname.includes('.')) return false

  const labels = hostname.split('.')
  const topLevelDomain = labels.at(-1)
  if (
    !topLevelDomain ||
    topLevelDomain.length < 2 ||
    topLevelDomain.length > 63 ||
    !isAsciiLetters(topLevelDomain)
  ) {
    return false
  }

  return labels.every(label => {
    if (
      label.length === 0 ||
      label.length > 63 ||
      label.startsWith('-') ||
      label.endsWith('-')
    ) {
      return false
    }

    return [...label].every(isAsciiLetterNumberOrHyphen)
  })
}

function isAsciiLetters(value: string): boolean {
  return [...value].every(character => {
    const code = character.toLocaleLowerCase().charCodeAt(0)
    return code >= 97 && code <= 122
  })
}

function isAsciiLetterNumberOrHyphen(character: string): boolean {
  const code = character.toLocaleLowerCase().charCodeAt(0)
  return (
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    character === '-'
  )
}
