import { cookies, headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { mapAgentRow, mapConversationRow } from '@/lib/agents/db'
import { getQrDataUrl } from '@/lib/qr'
import { AgentRightbar } from '@/components/agents/agent-rightbar'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet'

export const runtime = 'nodejs'

export default async function AgentSectionLayout({
  children,
  params
}: {
  children: React.ReactNode
  params: { id: string }
}) {
  const cookieStore = cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    redirect('/sign-in')
  }

  const supabase = createServerComponentClient<Database>({
    cookies: () => cookieStore
  })

  const { data } = await supabase
    .from('vibe_agents')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (!data) {
    notFound()
  }

  const agent = mapAgentRow(data)
  const { data: convoRows } = await supabase
    .from('vibe_agent_conversations')
    .select('*')
    .eq('agent_id', agent.id)
    .order('updated_at', { ascending: false })

  const conversations = (convoRows ?? []).map(mapConversationRow)

  const headersList = headers()
  const protocol =
    headersList.get('x-forwarded-proto') ??
    (headersList.get('host')?.startsWith('localhost') ? 'http' : 'https')
  const host = headersList.get('x-forwarded-host') ?? headersList.get('host')
  const origin =
    (protocol && host
      ? `${protocol}://${host}`
      : process.env.NEXT_PUBLIC_APP_URL) ?? 'http://localhost:3000'
  const shareUrl = `${origin}/a/${agent.agentUrl}`
  const qrDataUrl = await getQrDataUrl(shareUrl)

  return (
    <div className="relative flex-1">
      {/* Mobile: sheet-trigger to open details */}
      <div className="container mx-auto px-4 pt-4 lg:hidden">
        <div className="flex items-center justify-end">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="secondary" size="sm">Agent Details</Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[96vw] sm:w-[520px]">
              <SheetHeader>
                <SheetTitle>Agent Details</SheetTitle>
              </SheetHeader>
              <div className="mt-4 overflow-y-auto pb-6">
                {/* @ts-ignore */}
                <AgentRightbar
                  agent={agent}
                  share={{ url: shareUrl, qrDataUrl }}
                  conversations={conversations}
                />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Main content area reserves space on desktop for fixed right sidebar */}
      <div className="lg:mr-[520px]">{children}</div>

      {/* Desktop right sidebar (fixed) */}
      <div className="fixed right-0 top-16 bottom-0 hidden w-[90vw] max-w-[520px] overflow-y-auto border-l bg-background p-4 lg:block">
        {/* @ts-ignore */}
        <AgentRightbar
          agent={agent}
          share={{ url: shareUrl, qrDataUrl }}
          conversations={conversations}
        />
      </div>
    </div>
  )
}
