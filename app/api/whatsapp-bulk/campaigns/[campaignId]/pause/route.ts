import { NextRequest, NextResponse } from 'next/server';
import { pauseCampaign } from '@/lib/whatsapp-bulk/campaigns';

/**
 * POST - Pause a campaign
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { campaignId: string } }
) {
  try {
    await pauseCampaign(params.campaignId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to pause campaign:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to pause campaign' },
      { status: 500 }
    );
  }
}
