import { LandingHeader } from '@/components/landing/landing-header'
import { LandingFooter } from '@/components/landing/landing-footer'

export const metadata = {
  title: 'Terms of Service - Vibesboard',
  description: 'Terms of Service for the Vibesboard hosted service'
}

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

          <h2>1. Scope</h2>
          <p>
            These terms govern your use of the hosted Vibesboard website and
            service. They do not replace the licences that apply to Vibesboard&apos;s
            open-source code or bundled third-party software. If you run your own
            deployment, you are responsible for that deployment and for the terms
            you offer to its users.
          </p>

          <h2>2. Accounts and workspaces</h2>
          <p>
            You must provide accurate account information, protect your login
            credentials, and promptly tell us about unauthorised access. Workspace
            owners control membership, agents, integrations, and the content
            submitted through their workspace. You are responsible for activity
            performed through your account unless it resulted from our failure to
            use reasonable security measures.
          </p>

          <h2>3. Your content and integrations</h2>
          <p>
            You retain your rights in prompts, files, messages, agent
            configurations, and other content you submit. You grant us the limited
            permission necessary to host, process, transmit, and back up that
            content to provide and secure the service. You must have the rights and
            permissions required to submit content and connect third-party
            accounts.
          </p>

          <h2>4. AI-generated output</h2>
          <p>
            AI output can be incomplete, inaccurate, or unsuitable for your use.
            You are responsible for reviewing output before relying on it or
            sending it to customers. Do not use the service as the sole basis for
            decisions that create legal, medical, financial, employment, housing,
            insurance, or similarly significant consequences.
          </p>

          <h2>5. Acceptable use</h2>
          <p>You must not use the service to:</p>
          <ul>
            <li>break the law or infringe another person&apos;s rights;</li>
            <li>send spam, phishing, malware, or deceptive communications;</li>
            <li>access another workspace or account without authorisation;</li>
            <li>bypass limits or interfere with the service&apos;s operation; or</li>
            <li>probe for vulnerabilities except under our security policy.</li>
          </ul>

          <h2>6. Third-party services</h2>
          <p>
            Vibesboard can connect to model providers, messaging platforms,
            calendars, storage systems, and other services. Their terms and
            privacy practices apply to their services. We are not responsible for
            a third party&apos;s availability, changes, or handling of data outside
            our control.
          </p>

          <h2>7. Suspension and termination</h2>
          <p>
            You may stop using the hosted service at any time. We may suspend or
            terminate access when reasonably necessary to address illegal use, a
            security risk, material breach, or harm to the service or its users.
            Where practical, we will give notice and an opportunity to resolve the
            issue.
          </p>

          <h2>8. Availability and warranties</h2>
          <p>
            The hosted service is provided on an &quot;as is&quot; and &quot;as available&quot;
            basis. To the extent permitted by law, we disclaim implied warranties,
            including merchantability, fitness for a particular purpose, and
            non-infringement. Nothing in these terms excludes rights or warranties
            that applicable law does not allow us to exclude.
          </p>

          <h2>9. Liability</h2>
          <p>
            To the extent permitted by law, neither party is liable for indirect,
            incidental, special, consequential, or punitive loss arising from the
            service. These limitations do not apply where liability cannot legally
            be limited, including liability caused by fraud or wilful misconduct.
          </p>

          <h2>10. Changes and contact</h2>
          <p>
            We may update these terms to reflect changes to the service or law. We
            will update the date above and provide additional notice when a change
            materially affects users. Questions about these terms can be sent to{' '}
            <a href="mailto:hi@vibesboard.com">hi@vibesboard.com</a>.
          </p>
        </div>
      </div>
      <LandingFooter />
    </main>
  )
}
