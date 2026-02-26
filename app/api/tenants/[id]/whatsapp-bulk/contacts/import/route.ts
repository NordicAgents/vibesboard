import { NextRequest, NextResponse } from 'next/server';
import { importContacts } from '@/lib/whatsapp-bulk/contacts';
import { isFeatureEnabled } from '@/lib/features';
import { createClient } from '@/lib/supabase/server';

/**
 * POST - Import contacts from CSV
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id: tenantId } = params;

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

    if (!body.csvContent) {
      return NextResponse.json(
        { error: 'Missing required field: csvContent' },
        { status: 400 }
      );
    }

    const result = await importContacts({
      tenantId,
      csvContent: body.csvContent,
      listId: body.listId,
      autoOptIn: body.autoOptIn || false,
      userId: user.id,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Failed to import contacts:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to import contacts' },
      { status: 500 }
    );
  }
}
