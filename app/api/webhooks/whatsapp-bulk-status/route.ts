import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service-client';

/**
 * GET - Webhook verification (Meta requirement)
 * Meta will call this endpoint with hub.mode, hub.verify_token, and hub.challenge
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('Webhook verified successfully');
    return new NextResponse(challenge, { status: 200 });
  }

  console.error('Webhook verification failed');
  return NextResponse.json(
    { error: 'Verification failed' },
    { status: 403 }
  );
}

/**
 * POST - Handle webhook events from Meta
 * Updates message delivery status, read status, and errors
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Meta webhook structure
    if (body.object !== 'whatsapp_business_account') {
      return NextResponse.json({ error: 'Invalid object type' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Process each entry
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        const value = change.value;

        // Handle message status updates
        if (value.statuses && value.statuses.length > 0) {
          for (const status of value.statuses) {
            await updateMessageStatus(supabase, status);
          }
        }

        // Handle incoming messages (for opt-out)
        if (value.messages && value.messages.length > 0) {
          for (const message of value.messages) {
            await handleIncomingMessage(supabase, message);
          }
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Webhook processing error:', error);
    return NextResponse.json(
      { error: error.message || 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

/**
 * Update message status in queue
 */
async function updateMessageStatus(supabase: any, status: any) {
  const messageId = status.id;
  const statusType = status.status; // sent, delivered, read, failed

  try {
    const updateData: any = {};

    if (statusType === 'delivered') {
      updateData.status = 'delivered';
      updateData.delivered_at = new Date(status.timestamp * 1000).toISOString();

      // Update campaign stats
      const { data: queueItem } = await supabase
        .from('whatsapp_message_queue')
        .select('campaign_id')
        .eq('whatsapp_message_id', messageId)
        .single();

      if (queueItem) {
        await supabase
          .from('whatsapp_campaigns')
          .update({
            messages_delivered: supabase.raw('messages_delivered + 1'),
          })
          .eq('id', queueItem.campaign_id);
      }
    } else if (statusType === 'read') {
      updateData.status = 'read';
      updateData.read_at = new Date(status.timestamp * 1000).toISOString();

      // Update campaign stats
      const { data: queueItem } = await supabase
        .from('whatsapp_message_queue')
        .select('campaign_id')
        .eq('whatsapp_message_id', messageId)
        .single();

      if (queueItem) {
        await supabase
          .from('whatsapp_campaigns')
          .update({
            messages_read: supabase.raw('messages_read + 1'),
          })
          .eq('id', queueItem.campaign_id);
      }
    } else if (statusType === 'failed') {
      updateData.status = 'failed';
      updateData.failed_at = new Date(status.timestamp * 1000).toISOString();
      updateData.error_code = status.errors?.[0]?.code?.toString() || 'UNKNOWN';
      updateData.error_message = status.errors?.[0]?.message || 'Unknown error';
    }

    await supabase
      .from('whatsapp_message_queue')
      .update(updateData)
      .eq('whatsapp_message_id', messageId);

  } catch (error) {
    console.error('Failed to update message status:', error);
  }
}

/**
 * Handle incoming messages (for opt-out detection)
 */
async function handleIncomingMessage(supabase: any, message: any) {
  const from = message.from;
  const text = message.text?.body?.toLowerCase() || '';

  // Check for opt-out keywords
  if (text.includes('stop') || text.includes('unsubscribe') || text.includes('optout')) {
    try {
      // Find contact by phone number
      const phoneNormalized = from.replace(/\D/g, '');

      const { data: contact } = await supabase
        .from('whatsapp_contacts')
        .select('id')
        .eq('phone_number_normalized', phoneNormalized)
        .single();

      if (contact) {
        // Update opt-in status
        await supabase
          .from('whatsapp_contacts')
          .update({
            opted_in: false,
            opted_out_at: new Date().toISOString(),
          })
          .eq('id', contact.id);

        console.log(`Contact ${phoneNormalized} opted out`);
      }
    } catch (error) {
      console.error('Failed to handle opt-out:', error);
    }
  }
}
