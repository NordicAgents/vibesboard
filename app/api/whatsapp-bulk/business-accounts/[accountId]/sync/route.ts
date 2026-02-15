import { NextRequest, NextResponse } from 'next/server';
import { syncAccountStatus } from '@/lib/whatsapp-bulk/business-accounts';

/**
 * POST - Sync account status from Meta
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { accountId: string } }
) {
  try {
    await syncAccountStatus(params.accountId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to sync account status:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to sync account status' },
      { status: 500 }
    );
  }
}
