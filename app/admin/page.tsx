import Link from 'next/link'
import { Building2, Flag, FileText, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const adminCards = [
  {
    href: '/admin/tenants',
    icon: Building2,
    title: 'Tenants',
    description: 'Manage organizations and their settings',
    detail: 'View and configure tenant accounts',
  },
  {
    href: '/admin/feature-flags',
    icon: Flag,
    title: 'Feature Flags',
    description: 'Control feature rollouts and experiments',
    detail: 'Enable or disable features globally',
  },
  {
    href: '/admin/files',
    icon: FileText,
    title: 'File Processing',
    description: 'Monitor RAG file processing status',
    detail: 'View and manually trigger file indexing',
  },
]

export default function AdminPage() {
  return (
    <div className="space-y-8">
      <div className="animate-fade-slide-in">
        <p className="label-caps mb-1">System</p>
        <h1 className="font-serif text-2xl font-normal text-[#1A1915] dark:text-[#E8E3D8] sm:text-3xl">
          Admin Dashboard
        </h1>
        <p className="mt-1.5 text-sm text-[#6B6560] dark:text-[#9D9790]">
          Manage system-wide settings and monitor operations
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {adminCards.map((item, i) => (
          <Link
            key={item.href}
            href={item.href}
            className={`group animate-fade-slide-in stagger-${i + 1}`}
          >
            <Card className="h-full transition-all duration-[250ms] hover:-translate-y-0.5 hover:border-[#D97757]/40 hover:shadow-md">
              <CardHeader>
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#EDE8DE] dark:bg-[#2E2B25]">
                  <item.icon className="h-5 w-5 text-[#D97757]" />
                </div>
                <CardTitle className="flex items-center justify-between font-serif text-base font-normal">
                  {item.title}
                  <ArrowRight className="h-4 w-4 text-[#9D9790] opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
                </CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[#9D9790]">{item.detail}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
