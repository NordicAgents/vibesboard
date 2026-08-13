/**
 * Canonical outbound links for the marketing page.
 *
 * Everything the landing page points at lives here so a repo rename or a docs
 * move is one edit.
 */

export const GITHUB_OWNER = 'NordicAgents'
export const GITHUB_REPO = 'vibesboard'
export const GITHUB_SLUG = `${GITHUB_OWNER}/${GITHUB_REPO}`

export const REPO_URL = `https://github.com/${GITHUB_SLUG}`

/**
 * Docs are served from this app at `/docs` — same domain, same tab, so search
 * ranking and analytics compound on vibesboard.com instead of scattering onto
 * GitHub's file browser.
 */
export const docsUrl = (path: string) => `/docs/${path}`

export const LANDING_LINKS = {
  repo: REPO_URL,
  stars: `${REPO_URL}/stargazers`,
  issues: `${REPO_URL}/issues`,
  goodFirstIssues: `${REPO_URL}/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22`,
  releases: `${REPO_URL}/releases`,
  contributors: `${REPO_URL}/graphs/contributors`,
  license: `${REPO_URL}/blob/main/LICENSE`,
  readme: `${REPO_URL}#readme`,
  docs: '/docs',
  development: docsUrl('self-host/docker-compose'),
  deployment: docsUrl('self-host/cloud-run-deployment'),
  configuration: docsUrl('self-host/environment-variables'),
  architecture: docsUrl('contribute/architecture'),
  security: docsUrl('platform/security-and-credentials'),
  byoLlm: docsUrl('platform/bring-your-own-llm'),
  signIn: '/sign-in',
  signUp: '/sign-up',
  privacy: '/privacy-policy',
  terms: '/terms-of-service',
  email: 'mailto:hi@vibesboard.com',
  instagram: 'https://www.instagram.com/vibesboard_ai/',
  x: 'https://x.com/vibesboard_ai',
  linkedin: 'https://www.linkedin.com/company/vibesboard-ai/',
  youtube: 'https://www.youtube.com/@vibesboard_ai'
} as const

export interface LandingNavLink {
  href: string
  label: string
  external?: boolean
}

/**
 * The header nav.
 *
 * One real destination: the docs site. Everything else on the marketing page
 * sells itself by scrolling, so this is the only link worth pulling out of the
 * footer and into the header.
 */
export const LANDING_NAV_LINKS: LandingNavLink[] = [
  { href: LANDING_LINKS.docs, label: 'Docs' }
]

/** Sibling products — footer material, not navbar material. */
export const LANDING_PRODUCT_LINKS: LandingNavLink[] = [
  {
    href: 'https://social.vibesboard.com/',
    label: 'Feedback vibesboard',
    external: true
  },
  {
    href: 'https://org.vibesboard.com/',
    label: 'Enterprise vibesboard',
    external: true
  }
]
