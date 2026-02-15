import { NextRequest, NextResponse } from 'next/server';
import { getCampaignStats } from '@/lib/whatsapp-bulk/campaigns';

/**
 * GET - Get campaign statistics
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { campaignId: string } }
) {
  try {
    const stats = await getCampaignStats(params.campaignId);

    return NextResponse.json(stats);
  } catch (error: any) {
    console.error('Failed to get campaign stats:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get campaign stats' },
      { status: 500 }
    );
  }
}
