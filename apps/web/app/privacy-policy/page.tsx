import { LandingHeader } from '@/components/landing/landing-header'
import { LandingFooter } from '@/components/landing/landing-footer'
import {
  formatEntityInline,
  hasOperatorIdentity,
  legalEntity,
  supervisoryAuthorityPhrase
} from '@/lib/legal-entity'

export const metadata = {
  title: 'Privacy Policy - Vibesboard',
  description: 'Privacy Policy for the Vibesboard hosted service'
}

// Rendered per request so a deployment can change its operator identity through
// the LEGAL_* environment variables without rebuilding the image.
export const dynamic = 'force-dynamic'

export default function PrivacyPolicyPage() {
  return (
    <main className="dark h-full overflow-y-auto bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      <LandingHeader />
      <div className="container mx-auto px-4 py-24 sm:px-6 sm:py-32">
        <h1 className="mb-8 font-switzer text-4xl font-bold sm:text-5xl">
          Privacy Policy
        </h1>
        <div className="prose prose-lg max-w-none dark:prose-invert">
          <p className="mb-8 text-xl text-gray-secondary">
            Last updated: 12 August 2026
          </p>

          <h2>1. Who is responsible</h2>
          <p>
            {legalEntity.serviceHost
              ? `The Vibesboard service at ${legalEntity.serviceHost} is operated by `
              : 'This Vibesboard service is operated by '}
            <strong>{formatEntityInline()}</strong>, which is the data
            controller for the personal data described in this policy
            {legalEntity.contactEmail && (
              <>
                {' '}
                and can be reached at{' '}
                <a href={`mailto:${legalEntity.contactEmail}`}>
                  {legalEntity.contactEmail}
                </a>
              </>
            )}
            .
          </p>
          {!hasOperatorIdentity && (
            <p>
              <strong>This deployment has not published its operator.</strong>{' '}
              Whoever runs it is responsible for the processing described here.
              If you are that operator, set the <code>LEGAL_*</code> environment
              variables documented in <code>.env.example</code> — a hosted
              service that collects personal data has to identify its
              controller.
            </p>
          )}
          <p>
            This policy does not govern independent self-hosted deployments,
            which are operated by whoever runs them. A business using Vibesboard
            to communicate with its customers normally determines why those
            customer messages are processed; for that data we act as a processor
            on the business&apos;s instructions, so contact that business first
            about its use of your data.
          </p>

          <h2>2. Data we process</h2>
          <ul>
            <li>
              Account and workspace data, such as name, email address,
              memberships, roles, and authentication records.
            </li>
            <li>
              Content you provide, including prompts, messages, files, agent
              instructions, feedback, and booking information.
            </li>
            <li>
              Integration data needed to connect services such as model
              providers, Meta messaging products, Google Calendar, email, and
              object storage.
            </li>
            <li>
              Technical and usage data, including timestamps, request metadata,
              error information, token counts, and security events. Anonymous
              rate-limit identifiers are HMACed before storage.
            </li>
          </ul>

          <h2>3. Why we use data</h2>
          <p>We process data to:</p>
          <ul>
            <li>provide accounts, workspaces, agents, and integrations;</li>
            <li>route requests to the model or tool provider you select;</li>
            <li>secure, troubleshoot, and measure use of the service;</li>
            <li>send transactional account and service communications; and</li>
            <li>comply with legal obligations and enforce our terms.</li>
          </ul>
          <p>
            Depending on the context, our legal basis is performance of a
            contract, our legitimate interests in operating and securing the
            service, consent, or compliance with law.
          </p>

          <h2>4. AI providers and other recipients</h2>
          <p>
            Content is sent to the model provider and integrations configured
            for the relevant workspace. We also use infrastructure, database,
            storage, authentication, monitoring, and email providers to operate
            the hosted service. We disclose only the data needed for those
            services and do not sell personal data.
          </p>

          <h2>5. International transfers</h2>
          <p>
            Our providers and workspace-configured integrations may process data
            outside your country. Where required, we use recognised safeguards
            for international transfers. Workspace owners are responsible for
            evaluating providers they choose and any additional transfer
            requirements that apply to them.
          </p>

          <h2>6. Retention</h2>
          <p>
            We retain account and workspace data while the hosted account is
            active and afterwards only as needed for backups, security, dispute
            resolution, or legal obligations. Workspace owners control deletion
            of much of their agent and conversation content. Retention by a
            connected third party is governed by that party&apos;s settings and
            policies.
          </p>

          <h2>7. Security</h2>
          <p>
            We use access controls, tenant isolation, encryption for stored
            provider credentials, restricted administrative access, and
            automated security checks. No online service can guarantee absolute
            security. Please report suspected vulnerabilities through the
            process in our{' '}
            <a href="https://github.com/NordicAgents/vibesboard/security">
              security policy
            </a>
            .
          </p>

          <h2>8. Your choices and rights</h2>
          <p>
            Under the EU General Data Protection Regulation and equivalent local
            law, you may have rights to access, correct, delete, restrict,
            object to, or receive a copy of your personal data, and to withdraw
            consent. We may need to verify your identity before completing a
            request.
          </p>
          <p>
            You may also complain to a data protection authority
            {legalEntity.supervisoryAuthority ? (
              <>
                . Our lead supervisory authority is{' '}
                {supervisoryAuthorityPhrase()}
                {legalEntity.supervisoryAuthorityUrl && (
                  <>
                    , at{' '}
                    <a href={legalEntity.supervisoryAuthorityUrl}>
                      {legalEntity.supervisoryAuthorityUrl}
                    </a>
                  </>
                )}
              </>
            ) : (
              <> — {supervisoryAuthorityPhrase()}</>
            )}
            . If you live in the EU or EEA, you can complain to the authority
            where you live or work.
          </p>

          <h2>9. Children</h2>
          <p>
            The hosted service is intended for businesses and is not directed to
            children. Do not submit children&apos;s personal data unless you
            have a lawful basis and all permissions required for that
            processing.
          </p>

          <h2>10. Contact and changes</h2>
          <p>
            For privacy questions or rights requests, contact the operator
            {legalEntity.contactEmail && (
              <>
                {' '}
                at{' '}
                <a href={`mailto:${legalEntity.contactEmail}`}>
                  {legalEntity.contactEmail}
                </a>
              </>
            )}
            {hasOperatorIdentity && legalEntity.address.length > 0 && (
              <> or by post at the address below</>
            )}
            . We will update the date above when this policy changes and provide
            additional notice for material changes where required.
          </p>
          {hasOperatorIdentity && (
            <address className="not-italic">
              {legalEntity.name}
              <br />
              {legalEntity.address.map(line => (
                <span key={line}>
                  {line}
                  <br />
                </span>
              ))}
              {legalEntity.registrationNumber && (
                <>
                  Company registration number {legalEntity.registrationNumber}
                  <br />
                </>
              )}
              {legalEntity.vatNumber && <>VAT {legalEntity.vatNumber}</>}
            </address>
          )}
        </div>
      </div>
      <LandingFooter />
    </main>
  )
}
