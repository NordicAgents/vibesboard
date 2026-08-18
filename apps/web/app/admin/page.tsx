import Link from 'next/link'
import { Building2, FileText, Palette, ArrowRight } from 'lucide-react'
import { resolveEdition } from '@vibesboard/policy/edition'
import { getBilling } from '@/lib/billing'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'

const adminCards = [
  {
    href: '/admin/tenants',
    icon: Building2,
    title: 'Tenants',
    description: 'Manage organizations and their settings',
    detail: 'View and configure tenant accounts'
  },
  {
    href: '/admin/branding',
    icon: Palette,
    title: 'Branding',
    description: 'Set platform-wide default branding',
    detail: 'Configure base logo and colors inherited by all tenants'
  },
  {
    href: '/admin/files',
    icon: FileText,
    title: 'File Processing',
    description: 'Monitor RAG file processing status',
    detail: 'View and manually trigger file indexing'
  }
]

export default async function AdminPage() {
  // Which edition this container is actually running. Worth surfacing: the
  // edition depends on both an environment variable and whether `ee/` was
  // present at build time, so "did my enterprise deployment actually come up as
  // enterprise?" is otherwise only answerable by reading logs. See
  // /docs/contribute/open-core.
  const edition = resolveEdition()
  const billing = await getBilling()

  return (
    <div className="space-y-8">
      <div className="animate-fade-slide-in">
        <p className="label-caps mb-1">System</p>
        <h1 className="font-sans text-2xl font-normal text-[#222f30] dark:text-[#f5f8f7] sm:text-3xl">
          Admin Dashboard
        </h1>
        <p className="mt-1.5 text-sm text-[#445e5f] dark:text-[#6f7f80]">
          Manage system-wide settings and monitor operations
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {adminCards.map((item, i) => (
          <Link
            key={item.href}
            href={item.href}
            className={`stagger- group animate-fade-slide-in${i + 1}`}
          >
            <Card className="duration-[250ms] h-full transition-all hover:-translate-y-0.5 hover:border-[#a7e26e]/40 hover:shadow-md">
              <CardHeader>
                <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-[#e6ede6] dark:bg-[#344348]">
                  <item.icon className="size-5 text-accent-orange" />
                </div>
                <CardTitle className="flex items-center justify-between font-sans text-base font-normal">
                  {item.title}
                  <ArrowRight className="size-4 text-[#6f7f80] opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
                </CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[#6f7f80]">{item.detail}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="border-t border-[#e4e3e3] pt-6 dark:border-[#344348]">
        <p className="label-caps mb-1">Edition</p>
        <p className="text-sm text-[#445e5f] dark:text-[#6f7f80]">
          Running the{' '}
          <span className="font-medium text-[#222f30] dark:text-[#f5f8f7]">
            {edition}
          </span>{' '}
          edition, billing provider{' '}
          <span className="font-mono text-xs">{billing.kind}</span>.
        </p>
      </div>
    </div>
  )
}
