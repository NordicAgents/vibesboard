import { NextRequest, NextResponse } from 'next/server';
import {
  createContactList,
  listContactLists,
} from '@/lib/whatsapp-bulk/contacts';
import { isFeatureEnabled } from '@/lib/features';
import { createClient } from '@/lib/supabase/server';

/**
 * GET - List contact lists for a tenant
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

    const lists = await listContactLists(tenantId);

    return NextResponse.json({ lists });
  } catch (error: any) {
    console.error('Failed to list contact lists:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to list contact lists' },
      { status: 500 }
    );
  }
}

/**
 * POST - Create a new contact list
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

    if (!body.name) {
      return NextResponse.json(
        { error: 'Missing required field: name' },
        { status: 400 }
      );
    }

    const list = await createContactList({
      tenantId,
      name: body.name,
      description: body.description,
      contactIds: body.contactIds,
      userId: user.id,
    });

    return NextResponse.json({ list }, { status: 201 });
  } catch (error: any) {
    console.error('Failed to create contact list:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create contact list' },
      { status: 500 }
    );
  }
}
