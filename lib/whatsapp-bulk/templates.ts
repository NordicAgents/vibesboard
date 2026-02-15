import { createClient } from '@/lib/supabase/server';
import { decryptToken } from './business-accounts';

/**
 * WhatsApp Message Template Management
 *
 * Handles creation, submission, and synchronization of WhatsApp message templates:
 * - Create templates with variables, buttons, and media
 * - Submit to Meta for approval
 * - Sync approval status
 * - List approved templates for campaigns
 */

// =====================================================
// Types & Interfaces
// =====================================================

export interface CreateTemplateParams {
  businessAccountId: string;
  name: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language: string;
  bodyText: string;
  headerType?: 'text' | 'image' | 'video' | 'document';
  headerText?: string;
  headerMediaUrl?: string;
  footerText?: string;
  variables?: string[];
  buttons?: TemplateButton[];
}

export interface TemplateButton {
  type: 'url' | 'phone_number' | 'quick_reply';
  text: string;
  url?: string;
  phone_number?: string;
}

export interface MessageTemplate {
  id: string;
  business_account_id: string;
  name: string;
  language: string;
  category: string;
  header_type?: string;
  header_text?: string;
  header_media_url?: string;
  body_text: string;
  footer_text?: string;
  variables: string[];
  buttons: TemplateButton[];
  status: 'pending' | 'approved' | 'rejected';
  meta_template_id?: string;
  rejection_reason?: string;
  total_sent: number;
  last_used_at?: string;
  created_at: string;
  updated_at: string;
}

// =====================================================
// Meta Graph API Integration
// =====================================================

/**
 * Submit template to Meta WhatsApp Business API
 * Builds template payload and sends to Meta for approval
 */
async function submitTemplateToMeta(params: {
  businessAccountId: string;
  accessToken: string;
  name: string;
  category: string;
  language: string;
  bodyText: string;
  headerType?: string;
  headerText?: string;
  footerText?: string;
  buttons?: TemplateButton[];
}): Promise<string> {
  const url = `https://graph.facebook.com/v18.0/${params.businessAccountId}/message_templates`;

  const components: any[] = [];

  // Header component
  if (params.headerType && params.headerText) {
    components.push({
      type: 'HEADER',
      format: params.headerType.toUpperCase(),
      text: params.headerText,
    });
  }

  // Body component
  components.push({
    type: 'BODY',
    text: params.bodyText,
  });

  // Footer component
  if (params.footerText) {
    components.push({
      type: 'FOOTER',
      text: params.footerText,
    });
  }

  // Buttons component
  if (params.buttons && params.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: params.buttons.map(btn => ({
        type: btn.type.toUpperCase(),
        text: btn.text,
        ...(btn.url && { url: btn.url }),
        ...(btn.phone_number && { phone_number: btn.phone_number }),
      })),
    });
  }

  const payload = {
    name: params.name,
    language: params.language,
    category: params.category,
    components,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Meta API Error: ${data.error?.message || 'Unknown error'} (Code: ${data.error?.code || 'N/A'})`
    );
  }

  return data.id; // Meta's template ID
}

/**
 * Fetch template status from Meta
 */
async function fetchTemplateFromMeta(
  metaTemplateId: string,
  accessToken: string
): Promise<any> {
  const url = `https://graph.facebook.com/v18.0/${metaTemplateId}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Meta API Error: ${data.error?.message || 'Unknown error'} (Code: ${data.error?.code || 'N/A'})`
    );
  }

  return data;
}

// =====================================================
// Template Operations
// =====================================================

/**
 * Create message template and submit to Meta for approval
 *
 * Steps:
 * 1. Get business account
 * 2. Submit template to Meta
 * 3. Store in database
 */
export async function createMessageTemplate(
  params: CreateTemplateParams
): Promise<MessageTemplate> {
  const supabase = await createClient();

  // 1. Get business account
  const { data: account, error: accountError } = await supabase
    .from('tenant_whatsapp_business_accounts')
    .select('*')
    .eq('id', params.businessAccountId)
    .single();

  if (accountError) {
    throw new Error(`Failed to fetch business account: ${accountError.message}`);
  }

  // 2. Submit to Meta
  const accessToken = decryptToken(account.access_token);
  const metaTemplateId = await submitTemplateToMeta({
    businessAccountId: account.business_account_id,
    accessToken,
    ...params,
  });

  // 3. Store in database
  const { data, error } = await supabase
    .from('whatsapp_message_templates')
    .insert({
      business_account_id: params.businessAccountId,
      name: params.name,
      language: params.language,
      category: params.category,
      header_type: params.headerType,
      header_text: params.headerText,
      header_media_url: params.headerMediaUrl,
      body_text: params.bodyText,
      footer_text: params.footerText,
      variables: params.variables || [],
      buttons: params.buttons || [],
      status: 'pending',
      meta_template_id: metaTemplateId,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error(
        'A template with this name and language already exists for this account.'
      );
    }
    throw new Error(`Database error: ${error.message}`);
  }

  return data as MessageTemplate;
}

/**
 * Sync template status from Meta
 * Updates approval status and rejection reason if applicable
 */
export async function syncTemplateStatus(templateId: string): Promise<void> {
  const supabase = await createClient();

  // 1. Get template with business account
  const { data: template, error: templateError } = await supabase
    .from('whatsapp_message_templates')
    .select('*, tenant_whatsapp_business_accounts(*)')
    .eq('id', templateId)
    .single();

  if (templateError) {
    throw new Error(`Failed to fetch template: ${templateError.message}`);
  }

  if (!template.meta_template_id) {
    throw new Error('Template has no Meta template ID');
  }

  // 2. Fetch from Meta
  const accessToken = decryptToken(
    template.tenant_whatsapp_business_accounts.access_token
  );
  const metaTemplate = await fetchTemplateFromMeta(
    template.meta_template_id,
    accessToken
  );

  // 3. Update status
  const { error: updateError } = await supabase
    .from('whatsapp_message_templates')
    .update({
      status: metaTemplate.status.toLowerCase(),
      ...(metaTemplate.status === 'REJECTED' && {
        rejection_reason: metaTemplate.rejected_reason || 'No reason provided',
      }),
    })
    .eq('id', templateId);

  if (updateError) {
    throw new Error(`Failed to update template: ${updateError.message}`);
  }
}

/**
 * Get approved templates for a business account
 * Used when creating campaigns
 */
export async function getApprovedTemplates(
  businessAccountId: string
): Promise<MessageTemplate[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('whatsapp_message_templates')
    .select('*')
    .eq('business_account_id', businessAccountId)
    .eq('status', 'approved')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch templates: ${error.message}`);
  }

  return data as MessageTemplate[];
}

/**
 * List all templates for a business account
 * Includes pending, approved, and rejected templates
 */
export async function listTemplates(
  businessAccountId: string,
  status?: 'pending' | 'approved' | 'rejected'
): Promise<MessageTemplate[]> {
  const supabase = await createClient();

  let query = supabase
    .from('whatsapp_message_templates')
    .select('*')
    .eq('business_account_id', businessAccountId);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list templates: ${error.message}`);
  }

  return data as MessageTemplate[];
}

/**
 * Get a single template by ID
 */
export async function getTemplateById(
  templateId: string
): Promise<MessageTemplate | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('whatsapp_message_templates')
    .select('*')
    .eq('id', templateId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to fetch template: ${error.message}`);
  }

  return data as MessageTemplate;
}

/**
 * Delete a template
 * Note: Only deletes from database, not from Meta
 */
export async function deleteTemplate(templateId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('whatsapp_message_templates')
    .delete()
    .eq('id', templateId);

  if (error) {
    throw new Error(`Failed to delete template: ${error.message}`);
  }
}

/**
 * Increment template usage counter
 * Called when template is used in a campaign
 */
export async function incrementTemplateUsage(templateId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('whatsapp_message_templates')
    .update({
      total_sent: supabase.rpc('increment', { row_id: templateId }),
      last_used_at: new Date().toISOString(),
    })
    .eq('id', templateId);

  if (error) {
    // Non-critical error, log but don't throw
    console.error('Failed to increment template usage:', error.message);
  }
}

/**
 * Extract variables from template body text
 * Finds all {{1}}, {{2}}, etc. placeholders
 */
export function extractVariablesFromBody(bodyText: string): number[] {
  const regex = /\{\{(\d+)\}\}/g;
  const matches = [...bodyText.matchAll(regex)];
  return matches.map(match => parseInt(match[1])).sort((a, b) => a - b);
}

/**
 * Validate template before submission
 * Checks for common issues that would cause Meta rejection
 */
export function validateTemplate(params: CreateTemplateParams): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check name format (lowercase, underscores only)
  if (!/^[a-z0-9_]+$/.test(params.name)) {
    errors.push('Template name must contain only lowercase letters, numbers, and underscores');
  }

  // Check body text length
  if (params.bodyText.length > 1024) {
    errors.push('Body text must be 1024 characters or less');
  }

  // Check for variables
  const variables = extractVariablesFromBody(params.bodyText);
  if (variables.length > 0) {
    // Ensure variables are sequential (1, 2, 3, not 1, 3, 4)
    const expectedVariables = Array.from({ length: variables.length }, (_, i) => i + 1);
    if (JSON.stringify(variables) !== JSON.stringify(expectedVariables)) {
      errors.push('Variables must be sequential ({{1}}, {{2}}, {{3}}, etc.)');
    }

    // Ensure variable names are provided
    if (!params.variables || params.variables.length !== variables.length) {
      errors.push('Variable names must match the number of variables in the body text');
    }
  }

  // Check button count
  if (params.buttons && params.buttons.length > 3) {
    errors.push('Maximum 3 buttons allowed');
  }

  // Check button text length
  if (params.buttons) {
    params.buttons.forEach((btn, idx) => {
      if (btn.text.length > 20) {
        errors.push(`Button ${idx + 1} text must be 20 characters or less`);
      }
    });
  }

  // Check for promotional language (common rejection reasons)
  const promotionalKeywords = ['buy now', 'limited time', 'act fast', 'hurry', 'click here'];
  const lowerBody = params.bodyText.toLowerCase();
  const foundKeywords = promotionalKeywords.filter(keyword => lowerBody.includes(keyword));
  if (foundKeywords.length > 0) {
    errors.push(
      `Avoid overly promotional language: "${foundKeywords.join('", "')}". This may cause rejection.`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
