import { createServiceClient } from '@/lib/supabase/service-client';
import { decryptToken } from './business-accounts';
import { sendTemplateMessage, WhatsAppAPIError } from './template-sender';

/**
 * WhatsApp Message Queue Processor
 *
 * Processes pending messages from the database queue:
 * - Fetch pending messages (20 at a time)
 * - Send via Meta WhatsApp API
 * - Update status and handle retries
 * - Auto-complete campaigns when done
 *
 * Called by Vercel cron job every 30 seconds
 */

// =====================================================
// Types & Interfaces
// =====================================================

export interface ProcessResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

export interface QueueItem {
  id: string;
  campaign_id: string;
  business_account_id: string;
  contact_id?: string;
  to_phone_number: string;
  template_id?: string;
  template_name: string;
  template_language: string;
  template_variables: Record<string, string>;
  status: string;
  attempts: number;
  max_attempts: number;
  tenant_whatsapp_business_accounts: {
    id: string;
    phone_number_id: string;
    access_token: string;
    status: string;
  };
}

// =====================================================
// Queue Processing
// =====================================================

/**
 * Process pending messages from database queue
 * Called by cron job every 30 seconds
 *
 * @param batchSize Number of messages to process per run (default: 20)
 */
export async function processMessageQueue(batchSize: number = 20): Promise<ProcessResult> {
  const supabase = createServiceClient();

  const result: ProcessResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  try {
    // Fetch pending messages
    const { data: messages, error } = await supabase
      .from('whatsapp_message_queue')
      .select(`
        *,
        tenant_whatsapp_business_accounts(*)
      `)
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .order('created_at')
      .limit(batchSize);

    if (error) {
      console.error('Failed to fetch queue items:', error);
      return result;
    }

    if (!messages || messages.length === 0) {
      return result;
    }

    // Process each message
    for (const message of messages) {
      try {
        await processQueueItem(message as QueueItem, supabase);
        result.succeeded++;
      } catch (error) {
        console.error(`Failed to process queue item ${message.id}:`, error);
        result.failed++;
      }
      result.processed++;
    }

    return result;
  } catch (error) {
    console.error('Queue processing error:', error);
    throw error;
  }
}

/**
 * Process a single queue item
 */
async function processQueueItem(message: QueueItem, supabase: any): Promise<void> {
  // Check if account is disconnected
  if (message.tenant_whatsapp_business_accounts.status === 'disconnected') {
    await supabase
      .from('whatsapp_message_queue')
      .update({
        status: 'failed',
        failed_at: new Date().toISOString(),
        error_message: 'WhatsApp Business account is disconnected',
        error_code: 'ACCOUNT_DISCONNECTED',
        processed_at: new Date().toISOString(),
      })
      .eq('id', message.id);

    await supabase.rpc('increment_campaign_failed', {
      p_campaign_id: message.campaign_id,
    });

    return;
  }

  // Mark as processing (optimistic lock)
  const { error: lockError } = await supabase
    .from('whatsapp_message_queue')
    .update({
      status: 'processing',
      attempts: message.attempts + 1,
    })
    .eq('id', message.id)
    .eq('status', 'pending'); // Only update if still pending

  if (lockError) {
    // Another worker might have grabbed this message
    return;
  }

  try {
    // Decrypt access token
    const accessToken = decryptToken(
      message.tenant_whatsapp_business_accounts.access_token
    );

    // Send message via WhatsApp API
    const result = await sendTemplateMessage({
      phoneNumberId: message.tenant_whatsapp_business_accounts.phone_number_id,
      accessToken,
      to: message.to_phone_number,
      templateName: message.template_name,
      language: message.template_language,
      variables: message.template_variables,
    });

    // Mark as sent
    await supabase
      .from('whatsapp_message_queue')
      .update({
        status: 'sent',
        whatsapp_message_id: result.messageId,
        sent_at: new Date().toISOString(),
        processed_at: new Date().toISOString(),
      })
      .eq('id', message.id);

    // Update campaign stats
    await supabase.rpc('increment_campaign_sent', {
      p_campaign_id: message.campaign_id,
    });

  } catch (error) {
    const isLastAttempt = message.attempts + 1 >= message.max_attempts;
    let errorMessage = 'Unknown error';
    let errorCode = 'UNKNOWN';

    if (error instanceof WhatsAppAPIError) {
      errorMessage = error.message;
      errorCode = error.code.toString();
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    // Update queue item
    await supabase
      .from('whatsapp_message_queue')
      .update({
        status: isLastAttempt ? 'failed' : 'pending',
        failed_at: isLastAttempt ? new Date().toISOString() : null,
        error_message: errorMessage,
        error_code: errorCode,
        // Exponential backoff for retry
        scheduled_for: isLastAttempt
          ? null
          : new Date(Date.now() + Math.pow(2, message.attempts) * 1000).toISOString(),
        processed_at: new Date().toISOString(),
      })
      .eq('id', message.id);

    // Update campaign stats if final failure
    if (isLastAttempt) {
      await supabase.rpc('increment_campaign_failed', {
        p_campaign_id: message.campaign_id,
      });
    }

    throw error;
  }
}

/**
 * Process queue for a specific campaign
 * Used when resuming a paused campaign
 */
export async function processCampaignQueue(
  campaignId: string,
  batchSize: number = 20
): Promise<ProcessResult> {
  const supabase = createServiceClient();

  const result: ProcessResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  try {
    // Fetch pending messages for this campaign only
    const { data: messages, error } = await supabase
      .from('whatsapp_message_queue')
      .select(`
        *,
        tenant_whatsapp_business_accounts(*)
      `)
      .eq('campaign_id', campaignId)
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .order('created_at')
      .limit(batchSize);

    if (error) {
      console.error('Failed to fetch campaign queue items:', error);
      return result;
    }

    if (!messages || messages.length === 0) {
      return result;
    }

    // Process each message
    for (const message of messages) {
      try {
        await processQueueItem(message as QueueItem, supabase);
        result.succeeded++;
      } catch (error) {
        console.error(`Failed to process queue item ${message.id}:`, error);
        result.failed++;
      }
      result.processed++;
    }

    return result;
  } catch (error) {
    console.error('Campaign queue processing error:', error);
    throw error;
  }
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  pending: number;
  processing: number;
  sent: number;
  failed: number;
  total: number;
}> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('whatsapp_message_queue')
    .select('status');

  if (error) {
    throw new Error(`Failed to fetch queue stats: ${error.message}`);
  }

  const stats = {
    pending: 0,
    processing: 0,
    sent: 0,
    failed: 0,
    total: data.length,
  };

  data.forEach((item: any) => {
    if (item.status === 'pending') stats.pending++;
    else if (item.status === 'processing') stats.processing++;
    else if (item.status === 'sent' || item.status === 'delivered' || item.status === 'read') {
      stats.sent++;
    } else if (item.status === 'failed') stats.failed++;
  });

  return stats;
}

/**
 * Clear old processed messages
 * Should be run periodically to clean up the queue table
 *
 * @param olderThanDays Delete messages older than X days (default: 30)
 */
export async function clearOldQueueItems(olderThanDays: number = 30): Promise<number> {
  const supabase = createServiceClient();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  const { error, count } = await supabase
    .from('whatsapp_message_queue')
    .delete()
    .in('status', ['sent', 'delivered', 'read', 'failed', 'cancelled'])
    .lt('created_at', cutoffDate.toISOString());

  if (error) {
    throw new Error(`Failed to clear old queue items: ${error.message}`);
  }

  return count || 0;
}
