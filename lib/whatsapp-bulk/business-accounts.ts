import { createClient } from '@/lib/supabase/server';
import CryptoJS from 'crypto-js';

/**
 * WhatsApp Business Account Management
 *
 * Handles tenant-specific WhatsApp Business Account connections:
 * - Connect/disconnect accounts
 * - Token encryption/decryption
 * - Account status synchronization with Meta
 * - List tenant accounts
 */

// =====================================================
// Types & Interfaces
// =====================================================

export interface ConnectAccountParams {
  tenantId: string;
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  displayName?: string;
  userId: string;
}

export interface WhatsAppBusinessAccount {
  id: string;
  tenant_id: string;
  phone_number_id: string;
  business_account_id: string;
  phone_number: string;
  phone_number_normalized: string;
  status: 'pending' | 'verified' | 'suspended' | 'disconnected';
  quality_rating?: 'GREEN' | 'YELLOW' | 'RED';
  messaging_limit?: string;
  display_name?: string;
  timezone: string;
  verified_at?: string;
  webhook_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface MetaPhoneNumberInfo {
  display_phone_number: string;
  verified_name: string;
  quality_rating: string;
  code_verification_status?: string;
  id: string;
}

// =====================================================
// Token Encryption/Decryption
// =====================================================

/**
 * Encrypt access token before storing in database
 * Uses AES encryption with ENCRYPTION_KEY environment variable
 */
function encryptToken(token: string): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  return CryptoJS.AES.encrypt(token, key).toString();
}

/**
 * Decrypt access token for API calls
 * Uses AES decryption with ENCRYPTION_KEY environment variable
 */
export function decryptToken(encryptedToken: string): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  const bytes = CryptoJS.AES.decrypt(encryptedToken, key);
  return bytes.toString(CryptoJS.enc.Utf8);
}

// =====================================================
// Meta Graph API Integration
// =====================================================

/**
 * Verify phone number exists in Meta Graph API
 * Fetches phone number details including quality rating and verification status
 */
async function verifyPhoneNumberWithMeta(
  phoneNumberId: string,
  accessToken: string
): Promise<MetaPhoneNumberInfo> {
  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      `Meta API Error: ${error.error?.message || 'Unknown error'} (Code: ${error.error?.code || 'N/A'})`
    );
  }

  const data = await response.json();

  return {
    display_phone_number: data.display_phone_number,
    verified_name: data.verified_name,
    quality_rating: data.quality_rating || 'UNKNOWN',
    code_verification_status: data.code_verification_status,
    id: data.id,
  };
}

// =====================================================
// Business Account Operations
// =====================================================

/**
 * Connect a WhatsApp Business Account to a tenant
 *
 * Steps:
 * 1. Verify phone number exists in Meta
 * 2. Encrypt access token
 * 3. Insert into database
 *
 * @throws Error if Meta verification fails or database insert fails
 */
export async function connectWhatsAppBusinessAccount(
  params: ConnectAccountParams
): Promise<WhatsAppBusinessAccount> {
  const supabase = await createClient();

  // 1. Verify the phone number exists in Meta
  const phoneInfo = await verifyPhoneNumberWithMeta(
    params.phoneNumberId,
    params.accessToken
  );

  // 2. Encrypt the access token
  const encryptedToken = encryptToken(params.accessToken);

  // 3. Insert into database
  const { data, error } = await supabase
    .from('tenant_whatsapp_business_accounts')
    .insert({
      tenant_id: params.tenantId,
      phone_number_id: params.phoneNumberId,
      business_account_id: params.businessAccountId,
      access_token: encryptedToken,
      phone_number: phoneInfo.display_phone_number,
      phone_number_normalized: phoneInfo.display_phone_number.replace(/\D/g, ''),
      display_name: params.displayName || phoneInfo.verified_name,
      status: 'pending',
      quality_rating: phoneInfo.quality_rating,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error(
        'A WhatsApp Business account with this phone number is already connected to this tenant.'
      );
    }
    throw new Error(`Database error: ${error.message}`);
  }

  return data as WhatsAppBusinessAccount;
}

/**
 * Sync account status from Meta
 * Updates quality rating, messaging limits, and verification status
 */
export async function syncAccountStatus(accountId: string): Promise<void> {
  const supabase = await createClient();

  // 1. Get account
  const { data: account, error: fetchError } = await supabase
    .from('tenant_whatsapp_business_accounts')
    .select('*')
    .eq('id', accountId)
    .single();

  if (fetchError) {
    throw new Error(`Failed to fetch account: ${fetchError.message}`);
  }

  // 2. Decrypt token
  const accessToken = decryptToken(account.access_token);

  // 3. Fetch from Meta
  const phoneInfo = await verifyPhoneNumberWithMeta(
    account.phone_number_id,
    accessToken
  );

  // 4. Update database
  const { error: updateError } = await supabase
    .from('tenant_whatsapp_business_accounts')
    .update({
      quality_rating: phoneInfo.quality_rating,
      status: 'verified',
      verified_at: new Date().toISOString(),
    })
    .eq('id', accountId);

  if (updateError) {
    throw new Error(`Failed to update account: ${updateError.message}`);
  }
}

/**
 * List business accounts for a tenant
 * Returns all accounts ordered by creation date (newest first)
 */
export async function listBusinessAccounts(
  tenantId: string
): Promise<WhatsAppBusinessAccount[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('tenant_whatsapp_business_accounts')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list accounts: ${error.message}`);
  }

  return data as WhatsAppBusinessAccount[];
}

/**
 * Get a single business account by ID
 */
export async function getBusinessAccountById(
  accountId: string
): Promise<WhatsAppBusinessAccount | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('tenant_whatsapp_business_accounts')
    .select('*')
    .eq('id', accountId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to fetch account: ${error.message}`);
  }

  return data as WhatsAppBusinessAccount;
}

/**
 * Disconnect a WhatsApp Business Account
 * Sets status to 'disconnected' but preserves data for historical records
 */
export async function disconnectBusinessAccount(accountId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('tenant_whatsapp_business_accounts')
    .update({
      status: 'disconnected',
    })
    .eq('id', accountId);

  if (error) {
    throw new Error(`Failed to disconnect account: ${error.message}`);
  }
}

/**
 * Update account display name
 */
export async function updateAccountDisplayName(
  accountId: string,
  displayName: string
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('tenant_whatsapp_business_accounts')
    .update({
      display_name: displayName,
    })
    .eq('id', accountId);

  if (error) {
    throw new Error(`Failed to update account name: ${error.message}`);
  }
}

/**
 * Check if tenant has any active WhatsApp Business accounts
 */
export async function hasActiveAccount(tenantId: string): Promise<boolean> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('tenant_whatsapp_business_accounts')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('status', ['pending', 'verified'])
    .limit(1);

  if (error) {
    throw new Error(`Failed to check accounts: ${error.message}`);
  }

  return data.length > 0;
}

/**
 * Get account with decrypted token (for internal use only)
 * Used by queue processor and webhook handlers
 */
export async function getAccountWithToken(
  accountId: string
): Promise<{ account: WhatsAppBusinessAccount; accessToken: string }> {
  const account = await getBusinessAccountById(accountId);

  if (!account) {
    throw new Error('Account not found');
  }

  if (account.status === 'disconnected') {
    throw new Error('Account is disconnected');
  }

  const accessToken = decryptToken(account.access_token);

  return { account, accessToken };
}
