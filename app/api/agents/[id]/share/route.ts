import { NextResponse } from 'next/server'
import { cookies, headers } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { mapAgentRow } from '@/lib/agents/db'
import { getQrDataUrl } from '@/lib/qr'

export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const cookieStore = cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore
  })

  const { data } = await supabase
    .from('vibe_agents')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (!data) {
    return new NextResponse('Not found', { status: 404 })
  }

  const agent = mapAgentRow(data)
  const headersList = headers()
  const protocol =
    headersList.get('x-forwarded-proto') ??
    (headersList.get('host')?.startsWith('localhost') ? 'http' : 'https')
  const host = headersList.get('x-forwarded-host') ?? headersList.get('host')
  const origin =
    (protocol && host
      ? `${protocol}://${host}`
      : process.env.NEXT_PUBLIC_APP_URL) ?? 'http://localhost:3000'
  const url = `${origin}/a/${agent.agentUrl}`
  const qrDataUrl = await getQrDataUrl(url)

  return NextResponse.json({ url, qrDataUrl })
}
