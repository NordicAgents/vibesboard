/**
 * Identity of whoever operates *this* deployment, as shown on the landing page:
 * contact address, social accounts, sibling products, and the managed service
 * the "Hosted" option points at.
 *
 * NOTHING IS HARDCODED ON PURPOSE — the same reasoning as `legal-entity.ts`.
 * This repository is public, so anything baked in here is inherited by every
 * fork: a fork would publish someone else's support address, link to someone
 * else's social accounts, and funnel its own visitors into someone else's
 * paid hosting. The unconfigured state therefore shows nothing at all rather
 * than showing the upstream project's details.
 *
 * These are `NEXT_PUBLIC_*` because the landing copy is pulled into the client
 * bundle through `landing-hero-copy.ts`. That means they are inlined at build
 * time and changing one needs a rebuild — unlike the `LEGAL_*` variables, which
 * are read per request on server-rendered pages.
 *
 * Each variable is read as a literal `process.env.NEXT_PUBLIC_…` expression.
 * Next.js only inlines statically analysable reads, so a lookup like
 * `process.env[key]` would silently resolve to undefined in the browser.
 */

export interface LandingOperatorLink {
  label: string
  href: string
  external?: boolean
}

export interface LandingOperator {
  /** Public contact address. Empty string when unset. */
  contactEmail: string
  /** Social accounts to list in the footer. Empty when none are configured. */
  socials: LandingOperatorLink[]
  /** Other products by the same operator. Empty when none are configured. */
  siblingProducts: LandingOperatorLink[]
  /** Display name of the managed service, e.g. "example.com". */
  hostedName: string
  /** Where the hosted call to action points. */
  hostedUrl: string
}

const clean = (value: string | undefined): string => (value ?? '').trim()

const socialLink = (
  label: string,
  href: string | undefined
): LandingOperatorLink[] =>
  clean(href) ? [{ label, href: clean(href), external: true }] : []

/**
 * Parses `Label|https://url,Other|https://other` into links.
 *
 * Entries missing a label or a URL are dropped rather than rendered half
 * formed — a footer link with no destination is worse than no link.
 */
export function parseOperatorProducts(
  raw: string | undefined
): LandingOperatorLink[] {
  return clean(raw)
    .split(',')
    .map(entry => entry.split('|'))
    .flatMap(([label, href]) => {
      const trimmedLabel = clean(label)
      const trimmedHref = clean(href)
      if (!trimmedLabel || !trimmedHref) return []
      return [{ label: trimmedLabel, href: trimmedHref, external: true }]
    })
}

export const LANDING_OPERATOR: LandingOperator = {
  contactEmail: clean(process.env.NEXT_PUBLIC_OPERATOR_CONTACT_EMAIL),
  socials: [
    ...socialLink('X', process.env.NEXT_PUBLIC_OPERATOR_SOCIAL_X),
    ...socialLink('LinkedIn', process.env.NEXT_PUBLIC_OPERATOR_SOCIAL_LINKEDIN),
    ...socialLink(
      'Instagram',
      process.env.NEXT_PUBLIC_OPERATOR_SOCIAL_INSTAGRAM
    ),
    ...socialLink('YouTube', process.env.NEXT_PUBLIC_OPERATOR_SOCIAL_YOUTUBE)
  ],
  siblingProducts: parseOperatorProducts(
    process.env.NEXT_PUBLIC_OPERATOR_PRODUCTS
  ),
  hostedName: clean(process.env.NEXT_PUBLIC_OPERATOR_HOSTED_NAME),
  hostedUrl: clean(process.env.NEXT_PUBLIC_OPERATOR_HOSTED_URL)
}

/** Whether this deployment advertises a managed version of itself. */
export function hasHostedOffering(
  operator: LandingOperator = LANDING_OPERATOR
): boolean {
  return operator.hostedName.length > 0
}
