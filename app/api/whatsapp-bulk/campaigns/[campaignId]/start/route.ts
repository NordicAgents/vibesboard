import { NextRequest, NextResponse } from 'next/server';
import { startCampaign } from '@/lib/whatsapp-bulk/campaigns';

/**
 * POST - Start a campaign
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { campaignId: string } }
) {
  try {
    await startCampaign(params.campaignId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to start campaign:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to start campaign' },
      { status: 500 }
    );
  }
}
