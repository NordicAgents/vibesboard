import { NextRequest, NextResponse } from 'next/server';
import {
  connectWhatsAppBusinessAccount,
  listBusinessAccounts,
} from '@/lib/whatsapp-bulk/business-accounts';
import { isFeatureEnabled } from '@/lib/features';
import { createClient } from '@/lib/supabase/server';

/**
 * GET - List WhatsApp Business accounts for a tenant
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id: tenantId } = params;

    // Check if feature is enabled for this tenant
    const hasAccess = await isFeatureEnabled(tenantId, 'whatsapp_bulk_messaging');
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'WhatsApp Bulk Messaging is not enabled for this tenant' },
        { status: 403 }
      );
    }

    const accounts = await listBusinessAccounts(tenantId);

    return NextResponse.json({ accounts });
  } catch (error: any) {
    console.error('Failed to list business accounts:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to list business accounts' },
      { status: 500 }
    );
  }
}

/**
 * POST - Connect a new WhatsApp Business account
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id: tenantId } = params;

    // Check if feature is enabled for this tenant
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
    const { phoneNumberId, businessAccountId, accessToken, displayName } = body;

    // Validate required fields
    if (!phoneNumberId || !businessAccountId || !accessToken) {
      return NextResponse.json(
        { error: 'Missing required fields: phoneNumberId, businessAccountId, accessToken' },
        { status: 400 }
      );
    }

    const account = await connectWhatsAppBusinessAccount({
      tenantId,
      phoneNumberId,
      businessAccountId,
      accessToken,
      displayName,
      userId: user.id,
    });

    return NextResponse.json({ account }, { status: 201 });
  } catch (error: any) {
    console.error('Failed to connect business account:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to connect business account' },
      { status: 500 }
    );
  }
}
