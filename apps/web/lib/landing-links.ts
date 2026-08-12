/**
 * Canonical outbound links for the marketing page.
 *
 * Everything the landing page points at lives here so a repo rename or a docs
 * move is one edit, and so the tests can assert we never ship a link to a file
 * that does not exist in the repository.
 */

export const GITHUB_OWNER = 'NordicAgents'
export const GITHUB_REPO = 'vibeagent'
export const GITHUB_SLUG = `${GITHUB_OWNER}/${GITHUB_REPO}`

export const REPO_URL = `https://github.com/${GITHUB_SLUG}`

/** Docs live in the repository — link to the file, not to a docs site. */
export const docsUrl = (file: string) => `${REPO_URL}/blob/main/docs/${file}`

export const LANDING_LINKS = {
  repo: REPO_URL,
  stars: `${REPO_URL}/stargazers`,
  issues: `${REPO_URL}/issues`,
  goodFirstIssues: `${REPO_URL}/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22`,
  releases: `${REPO_URL}/releases`,
  contributors: `${REPO_URL}/graphs/contributors`,
  license: `${REPO_URL}/blob/main/LICENSE`,
  readme: `${REPO_URL}#readme`,
  docs: `${REPO_URL}/tree/main/docs`,
  development: docsUrl('development.md'),
  deployment: docsUrl('deployment.md'),
  configuration: docsUrl('configuration.md'),
  architecture: docsUrl('architecture.md'),
  security: docsUrl('security.md'),
  byoLlm: docsUrl('byo-llm.md'),
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
 * Empty on purpose: the header carries only the wordmark, the repository and a
 * sign-in, and the page sells itself by scrolling. Re-add entries here — e.g.
 * `{ href: LANDING_LINKS.docs, label: 'Docs', external: true }` or an in-page
 * `#quickstart` anchor — and the header renders the nav again on its own; the
 * section anchors and the footer columns already exist.
 */
export const LANDING_NAV_LINKS: LandingNavLink[] = []

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
