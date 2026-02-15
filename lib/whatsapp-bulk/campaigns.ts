import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service-client';

/**
 * WhatsApp Campaign Management
 *
 * Handles campaign creation, scheduling, and analytics:
 * - Create campaigns with templates and target lists
 * - Start/pause/resume campaigns
 * - Queue messages for processing
 * - Track campaign statistics
 */

// =====================================================
// Types & Interfaces
// =====================================================

export interface CreateCampaignParams {
  tenantId: string;
  businessAccountId: string;
  name: string;
  description?: string;
  templateId: string;
  templateVariables?: Record<string, string>;
  contactListIds: string[];
  filterCriteria?: any;
  scheduledAt?: Date;
  maxMessagesPerSecond?: number;
  userId: string;
}

export interface Campaign {
  id: string;
  tenant_id: string;
  business_account_id: string;
  name: string;
  description?: string;
  template_id: string;
  template_variables: Record<string, string>;
  contact_list_ids: string[];
  filter_criteria?: any;
  status: 'draft' | 'scheduled' | 'sending' | 'paused' | 'completed' | 'failed' | 'cancelled';
  scheduled_at?: string;
  started_at?: string;
  completed_at?: string;
  paused_at?: string;
  total_recipients: number;
  messages_sent: number;
  messages_delivered: number;
  messages_read: number;
  messages_failed: number;
  messages_pending: number;
  max_messages_per_second: number;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface CampaignStats {
  campaign: Campaign;
  deliveryRate: number;
  readRate: number;
  failureRate: number;
  estimatedCompletion?: string;
}

// =====================================================
// Campaign Operations
// =====================================================

/**
 * Create a new campaign
 */
export async function createCampaign(
  params: CreateCampaignParams
): Promise<Campaign> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('whatsapp_campaigns')
    .insert({
      tenant_id: params.tenantId,
      business_account_id: params.businessAccountId,
      name: params.name,
      description: params.description,
      template_id: params.templateId,
      template_variables: params.templateVariables || {},
      contact_list_ids: params.contactListIds,
      filter_criteria: params.filterCriteria,
      status: params.scheduledAt ? 'scheduled' : 'draft',
      scheduled_at: params.scheduledAt?.toISOString(),
      max_messages_per_second: params.maxMessagesPerSecond || 20,
      created_by: params.userId,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create campaign: ${error.message}`);
  }

  return data as Campaign;
}

/**
 * Start a campaign (queue all messages)
 */
export async function startCampaign(campaignId: string): Promise<void> {
  const supabase = createServiceClient();

  // 1. Get campaign details
  const { data: campaign, error: campaignError } = await supabase
    .from('whatsapp_campaigns')
    .select(`
      *,
      whatsapp_message_templates(*)
    `)
    .eq('id', campaignId)
    .single();

  if (campaignError) {
    throw new Error(`Failed to fetch campaign: ${campaignError.message}`);
  }

  if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
    throw new Error('Campaign must be in draft or scheduled status to start');
  }

  // 2. Get all contacts from specified lists
  const { data: members, error: membersError } = await supabase
    .from('whatsapp_contact_list_members')
    .select('whatsapp_contacts(*)')
    .in('list_id', campaign.contact_list_ids);

  if (membersError) {
    throw new Error(`Failed to fetch contacts: ${membersError.message}`);
  }

  // Filter opted-in contacts only
  const contacts = members
    .map((m: any) => m.whatsapp_contacts)
    .filter((c: any) => c.opted_in);

  if (contacts.length === 0) {
    throw new Error('No opted-in contacts found in selected lists');
  }

  // 3. Update campaign status
  const { error: updateError } = await supabase
    .from('whatsapp_campaigns')
    .update({
      status: 'sending',
      started_at: new Date().toISOString(),
      total_recipients: contacts.length,
      messages_pending: contacts.length,
    })
    .eq('id', campaignId);

  if (updateError) {
    throw new Error(`Failed to update campaign: ${updateError.message}`);
  }

  // 4. Queue all messages
  const queueItems = contacts.map((contact: any) => ({
    campaign_id: campaignId,
    business_account_id: campaign.business_account_id,
    contact_id: contact.id,
    to_phone_number: contact.phone_number,
    template_id: campaign.template_id,
    template_name: campaign.whatsapp_message_templates.name,
    template_language: campaign.whatsapp_message_templates.language,
    template_variables: {
      ...campaign.template_variables,
      // Personalize with contact data
      customer_name: contact.name || 'Customer',
      ...contact.custom_fields,
    },
    status: 'pending',
    max_attempts: 3,
  }));

  // Insert queue items in batches
  const batchSize = 1000;
  for (let i = 0; i < queueItems.length; i += batchSize) {
    const batch = queueItems.slice(i, i + batchSize);
    const { error: queueError } = await supabase
      .from('whatsapp_message_queue')
      .insert(batch);

    if (queueError) {
      throw new Error(`Failed to queue messages: ${queueError.message}`);
    }
  }
}

/**
 * Pause campaign
 */
export async function pauseCampaign(campaignId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('whatsapp_campaigns')
    .update({
      status: 'paused',
      paused_at: new Date().toISOString(),
    })
    .eq('id', campaignId)
    .eq('status', 'sending');

  if (error) {
    throw new Error(`Failed to pause campaign: ${error.message}`);
  }
}

/**
 * Resume campaign
 */
export async function resumeCampaign(campaignId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('whatsapp_campaigns')
    .update({
      status: 'sending',
      paused_at: null,
    })
    .eq('id', campaignId)
    .eq('status', 'paused');

  if (error) {
    throw new Error(`Failed to resume campaign: ${error.message}`);
  }
}

/**
 * Cancel campaign
 */
export async function cancelCampaign(campaignId: string): Promise<void> {
  const supabase = createServiceClient();

  // Update campaign status
  const { error: campaignError } = await supabase
    .from('whatsapp_campaigns')
    .update({
      status: 'cancelled',
    })
    .eq('id', campaignId)
    .in('status', ['draft', 'scheduled', 'sending', 'paused']);

  if (campaignError) {
    throw new Error(`Failed to cancel campaign: ${campaignError.message}`);
  }

  // Cancel pending queue items
  const { error: queueError } = await supabase
    .from('whatsapp_message_queue')
    .update({
      status: 'cancelled',
    })
    .eq('campaign_id', campaignId)
    .eq('status', 'pending');

  if (queueError) {
    throw new Error(`Failed to cancel queue items: ${queueError.message}`);
  }
}

/**
 * Get campaign statistics
 */
export async function getCampaignStats(campaignId: string): Promise<CampaignStats> {
  const supabase = await createClient();

  const { data: campaign, error } = await supabase
    .from('whatsapp_campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();

  if (error) {
    throw new Error(`Failed to fetch campaign: ${error.message}`);
  }

  const deliveryRate = campaign.total_recipients > 0
    ? (campaign.messages_delivered / campaign.total_recipients) * 100
    : 0;

  const readRate = campaign.messages_delivered > 0
    ? (campaign.messages_read / campaign.messages_delivered) * 100
    : 0;

  const failureRate = campaign.total_recipients > 0
    ? (campaign.messages_failed / campaign.total_recipients) * 100
    : 0;

  // Estimate completion time
  let estimatedCompletion: string | undefined;
  if (campaign.status === 'sending' && campaign.messages_pending > 0) {
    const messagesPerSecond = campaign.max_messages_per_second || 20;
    const secondsRemaining = campaign.messages_pending / messagesPerSecond;
    const completionDate = new Date(Date.now() + secondsRemaining * 1000);
    estimatedCompletion = completionDate.toISOString();
  }

  return {
    campaign: campaign as Campaign,
    deliveryRate,
    readRate,
    failureRate,
    estimatedCompletion,
  };
}

/**
 * List campaigns for a tenant
 */
export async function listCampaigns(
  tenantId: string,
  filters?: {
    status?: Campaign['status'];
    limit?: number;
    offset?: number;
  }
): Promise<{ campaigns: Campaign[]; total: number }> {
  const supabase = await createClient();

  let query = supabase
    .from('whatsapp_campaigns')
    .select('*', { count: 'exact' })
    .eq('tenant_id', tenantId);

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }

  if (filters?.limit) {
    query = query.limit(filters.limit);
  }

  if (filters?.offset) {
    query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1);
  }

  query = query.order('created_at', { ascending: false });

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to list campaigns: ${error.message}`);
  }

  return {
    campaigns: data as Campaign[],
    total: count || 0,
  };
}

/**
 * Get a single campaign by ID
 */
export async function getCampaignById(campaignId: string): Promise<Campaign | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('whatsapp_campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to fetch campaign: ${error.message}`);
  }

  return data as Campaign;
}

/**
 * Delete campaign
 */
export async function deleteCampaign(campaignId: string): Promise<void> {
  const supabase = await createClient();

  // Only allow deletion of draft campaigns
  const { data: campaign } = await supabase
    .from('whatsapp_campaigns')
    .select('status')
    .eq('id', campaignId)
    .single();

  if (campaign && campaign.status !== 'draft') {
    throw new Error('Can only delete draft campaigns');
  }

  const { error } = await supabase
    .from('whatsapp_campaigns')
    .delete()
    .eq('id', campaignId);

  if (error) {
    throw new Error(`Failed to delete campaign: ${error.message}`);
  }
}

/**
 * Get queue items for a campaign
 */
export async function getCampaignQueueItems(
  campaignId: string,
  filters?: {
    status?: string;
    limit?: number;
    offset?: number;
  }
): Promise<any[]> {
  const supabase = await createClient();

  let query = supabase
    .from('whatsapp_message_queue')
    .select('*')
    .eq('campaign_id', campaignId);

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }

  if (filters?.limit) {
    query = query.limit(filters.limit);
  }

  if (filters?.offset) {
    query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1);
  }

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch queue items: ${error.message}`);
  }

  return data;
}
