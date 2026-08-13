import { LandingHeader } from '@/components/landing/landing-header'
import { LandingFooter } from '@/components/landing/landing-footer'
import {
  formatEntityInline,
  forumPhrase,
  governingLawPhrase,
  hasOperatorIdentity,
  legalEntity
} from '@/lib/legal-entity'

export const metadata = {
  title: 'Terms of Service - Vibesboard',
  description: 'Terms of Service for the Vibesboard hosted service'
}

// Rendered per request so a deployment can change its operator identity through
// the LEGAL_* environment variables without rebuilding the image.
export const dynamic = 'force-dynamic'

export default function TermsOfServicePage() {
  return (
    <main className="dark h-full overflow-y-auto bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      <LandingHeader />
      <div className="container mx-auto px-4 py-24 sm:px-6 sm:py-32">
        <h1 className="mb-8 font-switzer text-4xl font-bold sm:text-5xl">
          Terms of Service
        </h1>
        <div className="prose prose-lg max-w-none dark:prose-invert">
          <p className="mb-8 text-xl text-gray-secondary">
            Last updated: 12 August 2026
          </p>

          <h2>1. Scope and who you are contracting with</h2>
          <p>
            These terms are an agreement between you and{' '}
            <strong>{formatEntityInline()}</strong> (&quot;we&quot;,
            &quot;us&quot;), who operates the Vibesboard website and service
            {legalEntity.serviceHost ? ` at ${legalEntity.serviceHost}` : ''}.
          </p>
          {!hasOperatorIdentity && (
            <p>
              <strong>This deployment has not published its operator.</strong>{' '}
              Until it does, these terms are a template rather than an
              enforceable agreement — a contract needs an identified party. If
              you run this deployment, set the <code>LEGAL_*</code> environment
              variables documented in <code>.env.example</code>.
            </p>
          )}
          <p>
            They do not replace the licences that apply to Vibesboard&apos;s
            open-source code or bundled third-party software. If you run your
            own deployment, you are responsible for that deployment and for the
            terms you offer to its users — these terms do not apply to it, and
            we are not a party to it.
          </p>

          <h2>2. Accounts and workspaces</h2>
          <p>
            You must provide accurate account information, protect your login
            credentials, and promptly tell us about unauthorised access.
            Workspace owners control membership, agents, integrations, and the
            content submitted through their workspace. You are responsible for
            activity performed through your account unless it resulted from our
            failure to use reasonable security measures.
          </p>

          <h2>3. Your content and integrations</h2>
          <p>
            You retain your rights in prompts, files, messages, agent
            configurations, and other content you submit. You grant us the
            limited permission necessary to host, process, transmit, and back up
            that content to provide and secure the service. You must have the
            rights and permissions required to submit content and connect
            third-party accounts.
          </p>

          <h2>4. AI-generated output</h2>
          <p>
            AI output can be incomplete, inaccurate, or unsuitable for your use.
            You are responsible for reviewing output before relying on it or
            sending it to customers. Do not use the service as the sole basis
            for decisions that create legal, medical, financial, employment,
            housing, insurance, or similarly significant consequences.
          </p>

          <h2>5. Acceptable use</h2>
          <p>You must not use the service to:</p>
          <ul>
            <li>break the law or infringe another person&apos;s rights;</li>
            <li>send spam, phishing, malware, or deceptive communications;</li>
            <li>access another workspace or account without authorisation;</li>
            <li>
              bypass limits or interfere with the service&apos;s operation; or
            </li>
            <li>probe for vulnerabilities except under our security policy.</li>
          </ul>

          <h2>6. Third-party services</h2>
          <p>
            Vibesboard can connect to model providers, messaging platforms,
            calendars, storage systems, and other services. Their terms and
            privacy practices apply to their services. We are not responsible
            for a third party&apos;s availability, changes, or handling of data
            outside our control.
          </p>

          <h2>7. Suspension and termination</h2>
          <p>
            You may stop using the hosted service at any time. We may suspend or
            terminate access when reasonably necessary to address illegal use, a
            security risk, material breach, or harm to the service or its users.
            Where practical, we will give notice and an opportunity to resolve
            the issue.
          </p>

          <h2>8. Availability and warranties</h2>
          <p>
            The hosted service is provided on an &quot;as is&quot; and &quot;as
            available&quot; basis. To the extent permitted by law, we disclaim
            implied warranties, including merchantability, fitness for a
            particular purpose, and non-infringement. Nothing in these terms
            excludes rights or warranties that applicable law does not allow us
            to exclude.
          </p>

          <h2>9. Liability</h2>
          <p>
            To the extent permitted by law, neither party is liable for
            indirect, incidental, special, consequential, or punitive loss
            arising from the service. These limitations do not apply where
            liability cannot legally be limited, including liability caused by
            fraud or wilful misconduct.
          </p>

          <h2>10. Governing law and disputes</h2>
          <p>
            These terms and any dispute arising out of them or the service are
            governed by {governingLawPhrase()}, excluding its conflict-of-law
            rules and the United Nations Convention on Contracts for the
            International Sale of Goods. Disputes will be brought before{' '}
            {forumPhrase()}, and each party submits to that forum.
          </p>
          <p>
            If you contract with us as a consumer rather than as a business,
            this section does not deprive you of the protection of mandatory
            provisions of the law of the country where you live, and you may
            bring proceedings in the courts of that country.
          </p>

          <h2>11. Changes and contact</h2>
          <p>
            We may update these terms to reflect changes to the service or law.
            We will update the date above and provide additional notice when a
            change materially affects users. Questions about these terms can be
            sent to the operator
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
              <> or posted to the address below</>
            )}
            .
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
