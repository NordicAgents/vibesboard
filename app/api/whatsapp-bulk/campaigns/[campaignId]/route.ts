import { NextRequest, NextResponse } from 'next/server';
import {
  getCampaignById,
  deleteCampaign,
} from '@/lib/whatsapp-bulk/campaigns';

/**
 * GET - Get a single campaign
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { campaignId: string } }
) {
  try {
    const campaign = await getCampaignById(params.campaignId);

    if (!campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ campaign });
  } catch (error: any) {
    console.error('Failed to fetch campaign:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch campaign' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Delete a campaign (draft only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { campaignId: string } }
) {
  try {
    await deleteCampaign(params.campaignId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete campaign:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete campaign' },
      { status: 500 }
    );
  }
}
