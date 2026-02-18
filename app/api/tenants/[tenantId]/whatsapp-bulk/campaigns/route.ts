import { NextRequest, NextResponse } from 'next/server';
import {
  createCampaign,
  listCampaigns,
} from '@/lib/whatsapp-bulk/campaigns';
import { isFeatureEnabled } from '@/lib/features';
import { createClient } from '@/lib/supabase/server';

/**
 * GET - List campaigns for a tenant
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { tenantId: string } }
) {
  try {
    const { tenantId } = params;

    // Check if feature is enabled
    const hasAccess = await isFeatureEnabled(tenantId, 'whatsapp_bulk_messaging');
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'WhatsApp Bulk Messaging is not enabled for this tenant' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as any;
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const result = await listCampaigns(tenantId, {
      status,
      limit,
      offset,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Failed to list campaigns:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to list campaigns' },
      { status: 500 }
    );
  }
}

/**
 * POST - Create a new campaign
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { tenantId: string } }
) {
  try {
    const { tenantId } = params;

    // Check if feature is enabled
    const hasAccess = await isFeatureEnabled(tenantId, 'whatsapp_bulk_messaging');
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'WhatsApp Bulk Messaging is not enabled for this tenant' },
        { status: 403 }
      );
    }

    // Get current user
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();

    // Validate required fields
    if (!body.businessAccountId || !body.name || !body.templateId || !body.contactListIds) {
      return NextResponse.json(
        { error: 'Missing required fields: businessAccountId, name, templateId, contactListIds' },
        { status: 400 }
      );
    }

    const campaign = await createCampaign({
      tenantId,
      businessAccountId: body.businessAccountId,
      name: body.name,
      description: body.description,
      templateId: body.templateId,
      templateVariables: body.templateVariables,
      contactListIds: body.contactListIds,
      filterCriteria: body.filterCriteria,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      maxMessagesPerSecond: body.maxMessagesPerSecond,
      userId: user.id,
    });

    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error: any) {
    console.error('Failed to create campaign:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create campaign' },
      { status: 500 }
    );
  }
}
