import { NextRequest, NextResponse } from 'next/server';
import { resumeCampaign } from '@/lib/whatsapp-bulk/campaigns';

/**
 * POST - Resume a campaign
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { campaignId: string } }
) {
  try {
    await resumeCampaign(params.campaignId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to resume campaign:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to resume campaign' },
      { status: 500 }
    );
  }
}
