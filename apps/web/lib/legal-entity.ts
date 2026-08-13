/**
 * Identity of the entity that operates a Vibesboard deployment, plus the law
 * that governs it. The privacy policy and terms of service render from here so
 * the legally significant details live in one reviewable place.
 *
 * NOTHING IS HARDCODED ON PURPOSE. This file ships with no operator baked in,
 * because this repository is public and every fork inherits its defaults. A
 * default legal name would mean any unconfigured deployment publishes someone
 * else's company as the party accountable for its data processing — a claim
 * that is false for the deployer and unwanted by the named company.
 *
 * So the unconfigured state is deliberately neutral: the documents still read
 * as coherent prose, they simply do not name anyone. Supply your own details
 * through the `LEGAL_*` environment variables (see `.env.example`) before you
 * run a deployment that real users sign up to — under GDPR Article 13 a hosted
 * service has to identify its controller, and Google OAuth verification and
 * Meta app review both check for it.
 *
 * Values are read at module scope, so a server-rendered page picks them up from
 * the process environment. The pages that consume them opt out of static
 * generation (`export const dynamic = 'force-dynamic'`) so a container image
 * built once can be re-pointed at a different operator by changing env vars
 * alone — no rebuild.
 */

export interface LegalEntity {
  /** Registered legal name of the operator, e.g. "Example AB". */
  name: string
  /** Company registration number, or an empty string if not applicable. */
  registrationNumber: string
  /**
   * VAT identification number, or an empty string if the operator is not VAT
   * registered. Swedish e-handelslagen § 8 (implementing the EU e-Commerce
   * Directive) requires a VAT-registered online seller to publish this
   * alongside its name and address.
   */
  vatNumber: string
  /** Postal address, one array entry per rendered line. */
  address: string[]
  /** Country whose law governs the terms, e.g. "Sweden". */
  governingCountry: string
  /** Forum for disputes, e.g. "the Stockholm District Court". */
  forum: string
  /** Data-protection supervisory authority for the governing country. */
  supervisoryAuthority: string
  supervisoryAuthorityUrl: string
  /** Address for privacy requests and general legal contact. */
  contactEmail: string
  /** Public hostname of the hosted service these documents describe. */
  serviceHost: string
}

/**
 * Reads one field. An explicitly empty override means "omit this line", and
 * only an *undefined* variable falls back — so a deployment can always suppress
 * a field it has no value for (no company number, not VAT registered) rather
 * than being stuck with whatever the fallback says.
 *
 * Every fallback in this file is currently the empty string, which is the whole
 * point: see the module comment.
 */
const optionalEnv = (key: string, fallback: string): string => {
  const raw = process.env[key]
  return raw === undefined ? fallback : raw.trim()
}

/**
 * Address lines are supplied as a single env var with `|` between lines, so one
 * Cloud Run / Docker variable can carry a multi-line postal address.
 */
const addressLines = (key: string, fallback: string[]): string[] => {
  const raw = process.env[key]?.trim()
  if (!raw) return fallback
  const lines = raw
    .split('|')
    .map(line => line.trim())
    .filter(Boolean)
  return lines.length > 0 ? lines : fallback
}

export const legalEntity: LegalEntity = {
  name: optionalEnv('LEGAL_ENTITY_NAME', ''),
  registrationNumber: optionalEnv('LEGAL_ENTITY_REGISTRATION_NUMBER', ''),
  vatNumber: optionalEnv('LEGAL_ENTITY_VAT_NUMBER', ''),
  address: addressLines('LEGAL_ENTITY_ADDRESS', []),
  governingCountry: optionalEnv('LEGAL_GOVERNING_COUNTRY', ''),
  forum: optionalEnv('LEGAL_FORUM', ''),
  supervisoryAuthority: optionalEnv('LEGAL_SUPERVISORY_AUTHORITY', ''),
  supervisoryAuthorityUrl: optionalEnv('LEGAL_SUPERVISORY_AUTHORITY_URL', ''),
  contactEmail: optionalEnv('LEGAL_CONTACT_EMAIL', ''),
  serviceHost: optionalEnv('LEGAL_SERVICE_HOST', '')
}

/** True once a deployment has named the entity that operates it. */
export const hasOperatorIdentity = legalEntity.name.length > 0

/**
 * The operator as a single inline phrase. Falls back to a neutral description
 * rather than a name, so an unconfigured deployment reads as anonymous instead
 * of attributing itself to whoever happened to be the default.
 */
export function formatEntityInline(entity: LegalEntity = legalEntity): string {
  // Phrased as a noun describing a party, not as "the operator", so that the
  // surrounding sentences ("... is operated by X", "between you and X") do not
  // read as "operated by the operator of this deployment".
  if (!entity.name) return 'the person or company that runs this deployment'

  const identifiers = [
    entity.registrationNumber &&
      `company registration number ${entity.registrationNumber}`,
    entity.vatNumber && `VAT ${entity.vatNumber}`
  ].filter(Boolean)

  const suffix = identifiers.length > 0 ? ` (${identifiers.join(', ')})` : ''
  const address =
    entity.address.length > 0 ? `, ${entity.address.join(', ')}` : ''
  return `${entity.name}${suffix}${address}`
}

/** "the laws of X", or a country-agnostic phrasing when none is configured. */
export function governingLawPhrase(entity: LegalEntity = legalEntity): string {
  return entity.governingCountry
    ? `the laws of ${entity.governingCountry}`
    : 'the laws of the country in which the operator is established'
}

/** The dispute forum, or a country-agnostic fallback. */
export function forumPhrase(entity: LegalEntity = legalEntity): string {
  return entity.forum || 'the competent courts of that country'
}

/** Named supervisory authority, or the reader's own local one. */
export function supervisoryAuthorityPhrase(
  entity: LegalEntity = legalEntity
): string {
  return entity.supervisoryAuthority || 'your local data protection authority'
}

/** Hostname of this deployment, or a neutral description of it. */
export function serviceHostPhrase(entity: LegalEntity = legalEntity): string {
  return entity.serviceHost || 'this deployment'
}
