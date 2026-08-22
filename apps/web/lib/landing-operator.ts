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
 * Read per request on the server, exactly like `LEGAL_*`: a container image
 * built once can be re-pointed at a different operator by changing environment
 * variables alone, with no rebuild and no Docker build arguments.
 *
 * That only holds while this module stays out of the client bundle, so it is
 * marked `server-only`. Nothing here may be re-exported from a module a
 * `'use client'` component imports — `landing-links.ts` deliberately does not,
 * and `landing-sections-copy.ts` imports the *type* only. If a future change
 * breaks that, the build fails here rather than silently shipping empty values
 * to the browser.
 */

import 'server-only'

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
  contactEmail: clean(process.env.OPERATOR_CONTACT_EMAIL),
  socials: [
    ...socialLink('X', process.env.OPERATOR_SOCIAL_X),
    ...socialLink('LinkedIn', process.env.OPERATOR_SOCIAL_LINKEDIN),
    ...socialLink('Instagram', process.env.OPERATOR_SOCIAL_INSTAGRAM),
    ...socialLink('YouTube', process.env.OPERATOR_SOCIAL_YOUTUBE)
  ],
  siblingProducts: parseOperatorProducts(process.env.OPERATOR_PRODUCTS),
  hostedName: clean(process.env.OPERATOR_HOSTED_NAME),
  hostedUrl: clean(process.env.OPERATOR_HOSTED_URL)
}
