import { NextRequest, NextResponse } from 'next/server'

import { searchDocs } from '@/lib/docs/search'

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q') ?? ''
  const results = searchDocs(query)
  return NextResponse.json({ results })
}
