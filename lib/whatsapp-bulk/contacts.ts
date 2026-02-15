import { createClient } from '@/lib/supabase/server';
import { parse } from 'csv-parse/sync';

/**
 * WhatsApp Contact Management
 *
 * Handles contact import, management, and opt-in tracking:
 * - Import contacts from CSV
 * - Create and manage contact lists
 * - Track opt-in/opt-out status (GDPR compliance)
 * - Validate phone numbers
 */

// =====================================================
// Types & Interfaces
// =====================================================

export interface CreateContactParams {
  tenantId: string;
  phoneNumber: string;
  name?: string;
  email?: string;
  optedIn: boolean;
  optInSource?: string;
  customFields?: Record<string, any>;
  tags?: string[];
}

export interface Contact {
  id: string;
  tenant_id: string;
  phone_number: string;
  phone_number_normalized: string;
  name?: string;
  email?: string;
  opted_in: boolean;
  opted_in_at?: string;
  opted_out_at?: string;
  opt_in_source?: string;
  custom_fields: Record<string, any>;
  tags: string[];
  source: string;
  created_at: string;
  updated_at: string;
}

export interface ContactList {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  total_contacts: number;
  opted_in_count: number;
  tags: string[];
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface ImportResult {
  imported: number;
  errors: string[];
  contactIds: string[];
}

// =====================================================
// Phone Number Validation
// =====================================================

/**
 * Validate and normalize phone number
 * Returns E.164 format and normalized version
 */
export function validatePhoneNumber(phoneNumber: string): {
  isValid: boolean;
  normalized: string;
  e164: string;
} {
  // Remove all non-digit characters
  const normalized = phoneNumber.replace(/\D/g, '');

  // Build E.164 format
  const e164 = phoneNumber.startsWith('+') ? phoneNumber : `+${normalized}`;

  // Validate E.164 format: + followed by 7-15 digits
  const isValid = /^\+[1-9]\d{7,14}$/.test(e164);

  return { isValid, normalized, e164 };
}

// =====================================================
// Contact Operations
// =====================================================

/**
 * Create a single contact
 */
export async function createContact(params: CreateContactParams): Promise<Contact> {
  const supabase = await createClient();

  const { isValid, normalized, e164 } = validatePhoneNumber(params.phoneNumber);

  if (!isValid) {
    throw new Error(
      `Invalid phone number format: ${params.phoneNumber}. Must be E.164 format (e.g., +1234567890)`
    );
  }

  const { data, error } = await supabase
    .from('whatsapp_contacts')
    .insert({
      tenant_id: params.tenantId,
      phone_number: e164,
      phone_number_normalized: normalized,
      name: params.name,
      email: params.email,
      opted_in: params.optedIn,
      opted_in_at: params.optedIn ? new Date().toISOString() : null,
      opt_in_source: params.optInSource || 'manual',
      custom_fields: params.customFields || {},
      tags: params.tags || [],
      source: 'manual',
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('Contact with this phone number already exists.');
    }
    throw new Error(`Database error: ${error.message}`);
  }

  return data as Contact;
}

/**
 * Import contacts from CSV
 * Supports columns: phone_number, name, email, opted_in, tags, custom_fields
 */
export async function importContacts(params: {
  tenantId: string;
  csvContent: string;
  listId?: string;
  autoOptIn?: boolean;
  userId: string;
}): Promise<ImportResult> {
  const supabase = await createClient();

  // Parse CSV
  const records = parse(params.csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const errors: string[] = [];
  const contactIds: string[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    try {
      // Validate required field
      if (!record.phone_number) {
        errors.push(`Row ${i + 1}: Missing phone_number`);
        continue;
      }

      const { isValid, normalized, e164 } = validatePhoneNumber(record.phone_number);

      if (!isValid) {
        errors.push(`Row ${i + 1}: Invalid phone number "${record.phone_number}"`);
        continue;
      }

      // Parse custom fields if present
      let customFields = {};
      if (record.custom_fields) {
        try {
          customFields = JSON.parse(record.custom_fields);
        } catch {
          errors.push(`Row ${i + 1}: Invalid JSON in custom_fields`);
          continue;
        }
      }

      // Parse tags if present
      let tags: string[] = [];
      if (record.tags) {
        tags = record.tags.split(',').map((t: string) => t.trim());
      }

      // Upsert contact
      const { data, error } = await supabase
        .from('whatsapp_contacts')
        .upsert(
          {
            tenant_id: params.tenantId,
            phone_number: e164,
            phone_number_normalized: normalized,
            name: record.name || null,
            email: record.email || null,
            opted_in: params.autoOptIn || record.opted_in === 'true',
            opted_in_at: params.autoOptIn ? new Date().toISOString() : null,
            opt_in_source: 'import',
            custom_fields: customFields,
            tags,
            source: 'import',
          },
          { onConflict: 'tenant_id,phone_number_normalized' }
        )
        .select()
        .single();

      if (error) {
        errors.push(`Row ${i + 1}: ${error.message}`);
        continue;
      }

      contactIds.push(data.id);

      // Add to list if specified
      if (params.listId) {
        await supabase.from('whatsapp_contact_list_members').insert({
          contact_id: data.id,
          list_id: params.listId,
          added_by: params.userId,
        }).select().single();
      }
    } catch (err: any) {
      errors.push(`Row ${i + 1}: ${err.message}`);
    }
  }

  return {
    imported: contactIds.length,
    errors,
    contactIds,
  };
}

/**
 * Update opt-in status for a contact
 */
export async function updateOptInStatus(
  contactId: string,
  optedIn: boolean
): Promise<void> {
  const supabase = await createClient();

  const updateData: any = {
    opted_in: optedIn,
  };

  if (optedIn) {
    updateData.opted_in_at = new Date().toISOString();
    updateData.opted_out_at = null;
  } else {
    updateData.opted_out_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('whatsapp_contacts')
    .update(updateData)
    .eq('id', contactId);

  if (error) {
    throw new Error(`Failed to update opt-in status: ${error.message}`);
  }
}

/**
 * List contacts for a tenant
 */
export async function listContacts(
  tenantId: string,
  filters?: {
    optedIn?: boolean;
    tags?: string[];
    search?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ contacts: Contact[]; total: number }> {
  const supabase = await createClient();

  let query = supabase
    .from('whatsapp_contacts')
    .select('*', { count: 'exact' })
    .eq('tenant_id', tenantId);

  // Apply filters
  if (filters?.optedIn !== undefined) {
    query = query.eq('opted_in', filters.optedIn);
  }

  if (filters?.tags && filters.tags.length > 0) {
    query = query.contains('tags', filters.tags);
  }

  if (filters?.search) {
    query = query.or(
      `name.ilike.%${filters.search}%,phone_number.ilike.%${filters.search}%,email.ilike.%${filters.search}%`
    );
  }

  // Pagination
  if (filters?.limit) {
    query = query.limit(filters.limit);
  }

  if (filters?.offset) {
    query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1);
  }

  query = query.order('created_at', { ascending: false });

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to list contacts: ${error.message}`);
  }

  return {
    contacts: data as Contact[],
    total: count || 0,
  };
}

/**
 * Get a single contact by ID
 */
export async function getContactById(contactId: string): Promise<Contact | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('whatsapp_contacts')
    .select('*')
    .eq('id', contactId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to fetch contact: ${error.message}`);
  }

  return data as Contact;
}

/**
 * Delete a contact (GDPR compliance)
 */
export async function deleteContact(contactId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('whatsapp_contacts')
    .delete()
    .eq('id', contactId);

  if (error) {
    throw new Error(`Failed to delete contact: ${error.message}`);
  }
}

// =====================================================
// Contact List Operations
// =====================================================

/**
 * Create contact list
 */
export async function createContactList(params: {
  tenantId: string;
  name: string;
  description?: string;
  contactIds?: string[];
  userId: string;
}): Promise<ContactList> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('whatsapp_contact_lists')
    .insert({
      tenant_id: params.tenantId,
      name: params.name,
      description: params.description,
      total_contacts: params.contactIds?.length || 0,
      created_by: params.userId,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create contact list: ${error.message}`);
  }

  // Add contacts to list
  if (params.contactIds && params.contactIds.length > 0) {
    const members = params.contactIds.map(contactId => ({
      contact_id: contactId,
      list_id: data.id,
      added_by: params.userId,
    }));

    const { error: memberError } = await supabase
      .from('whatsapp_contact_list_members')
      .insert(members);

    if (memberError) {
      // Rollback list creation
      await supabase.from('whatsapp_contact_lists').delete().eq('id', data.id);
      throw new Error(`Failed to add contacts to list: ${memberError.message}`);
    }
  }

  return data as ContactList;
}

/**
 * List contact lists for a tenant
 */
export async function listContactLists(tenantId: string): Promise<ContactList[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('whatsapp_contact_lists')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list contact lists: ${error.message}`);
  }

  return data as ContactList[];
}

/**
 * Get contacts in a list
 */
export async function getListContacts(listId: string): Promise<Contact[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('whatsapp_contact_list_members')
    .select('whatsapp_contacts(*)')
    .eq('list_id', listId);

  if (error) {
    throw new Error(`Failed to fetch list contacts: ${error.message}`);
  }

  return data.map((item: any) => item.whatsapp_contacts as Contact);
}

/**
 * Add contacts to a list
 */
export async function addContactsToList(
  listId: string,
  contactIds: string[],
  userId: string
): Promise<void> {
  const supabase = await createClient();

  const members = contactIds.map(contactId => ({
    contact_id: contactId,
    list_id: listId,
    added_by: userId,
  }));

  const { error } = await supabase
    .from('whatsapp_contact_list_members')
    .insert(members);

  if (error) {
    throw new Error(`Failed to add contacts to list: ${error.message}`);
  }

  // Update contact count
  await updateContactListCounts(listId);
}

/**
 * Remove contacts from a list
 */
export async function removeContactsFromList(
  listId: string,
  contactIds: string[]
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('whatsapp_contact_list_members')
    .delete()
    .eq('list_id', listId)
    .in('contact_id', contactIds);

  if (error) {
    throw new Error(`Failed to remove contacts from list: ${error.message}`);
  }

  // Update contact count
  await updateContactListCounts(listId);
}

/**
 * Update contact list counts (total and opted-in)
 */
export async function updateContactListCounts(listId: string): Promise<void> {
  const supabase = await createClient();

  // Get all contacts in list
  const contacts = await getListContacts(listId);

  const totalContacts = contacts.length;
  const optedInCount = contacts.filter(c => c.opted_in).length;

  const { error } = await supabase
    .from('whatsapp_contact_lists')
    .update({
      total_contacts: totalContacts,
      opted_in_count: optedInCount,
    })
    .eq('id', listId);

  if (error) {
    throw new Error(`Failed to update list counts: ${error.message}`);
  }
}

/**
 * Delete contact list
 */
export async function deleteContactList(listId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('whatsapp_contact_lists')
    .delete()
    .eq('id', listId);

  if (error) {
    throw new Error(`Failed to delete contact list: ${error.message}`);
  }
}
