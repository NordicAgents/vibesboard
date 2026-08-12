import { LandingHeader } from '@/components/landing/landing-header'
import { LandingFooter } from '@/components/landing/landing-footer'

export const metadata = {
  title: 'Privacy Policy - Vibesboard',
  description: 'Privacy Policy for the Vibesboard hosted service'
}

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

          <h2>1. Scope and responsibility</h2>
          <p>
            This policy describes how the operator of the hosted Vibesboard
            service at vibesboard.com handles personal data. It does not govern
            independent self-hosted deployments. A business using Vibesboard to
            communicate with its customers normally determines why those customer
            messages are processed; contact that business first about its use of
            your data.
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
            Content is sent to the model provider and integrations configured for
            the relevant workspace. We also use infrastructure, database, storage,
            authentication, monitoring, and email providers to operate the hosted
            service. We disclose only the data needed for those services and do
            not sell personal data.
          </p>

          <h2>5. International transfers</h2>
          <p>
            Our providers and workspace-configured integrations may process data
            outside your country. Where required, we use recognised safeguards for
            international transfers. Workspace owners are responsible for
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
            provider credentials, restricted administrative access, and automated
            security checks. No online service can guarantee absolute security.
            Please report suspected vulnerabilities through the process in our{' '}
            <a href="https://github.com/NordicAgents/vibesboard/security">
              security policy
            </a>
            .
          </p>

          <h2>8. Your choices and rights</h2>
          <p>
            Depending on where you live, you may have rights to access, correct,
            delete, restrict, object to, or receive a copy of your personal data,
            and to withdraw consent. You may also complain to your local data
            protection authority. We may need to verify your identity before
            completing a request.
          </p>

          <h2>9. Children</h2>
          <p>
            The hosted service is intended for businesses and is not directed to
            children. Do not submit children&apos;s personal data unless you have a
            lawful basis and all permissions required for that processing.
          </p>

          <h2>10. Contact and changes</h2>
          <p>
            For privacy questions or rights requests, contact{' '}
            <a href="mailto:hi@vibesboard.com">hi@vibesboard.com</a>. We will
            update the date above when this policy changes and provide additional
            notice for material changes where required.
          </p>
        </div>
      </div>
      <LandingFooter />
    </main>
  )
}
