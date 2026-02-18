import { NextRequest, NextResponse } from 'next/server';
import { syncTemplateStatus } from '@/lib/whatsapp-bulk/templates';

/**
 * POST - Sync template status from Meta
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { templateId: string } }
) {
  try {
    await syncTemplateStatus(params.templateId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to sync template status:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to sync template status' },
      { status: 500 }
    );
  }
}
