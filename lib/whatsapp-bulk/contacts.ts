import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  Collections,
  type WhatsAppContactDocument,
  type WhatsAppContactListDocument,
} from '@/lib/firestore-types'
import { parse } from 'csv-parse/sync'

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
  tenantId: string
  phoneNumber: string
  name?: string
  email?: string
  optedIn: boolean
  optInSource?: string
  customFields?: Record<string, any>
  tags?: string[]
}

export type Contact = WhatsAppContactDocument

export type ContactList = WhatsAppContactListDocument

export interface ImportResult {
  imported: number
  errors: string[]
  contactIds: string[]
}

// =====================================================
// Phone Number Validation
// =====================================================

/**
 * Validate and normalize phone number
 * Returns E.164 format and normalized version
 */
export function validatePhoneNumber(phoneNumber: string): {
  isValid: boolean
  normalized: string
  e164: string
} {
  // Remove all non-digit characters
  const normalized = phoneNumber.replace(/\D/g, '')

  // Build E.164 format
  const e164 = phoneNumber.startsWith('+') ? phoneNumber : `+${normalized}`

  // Validate E.164 format: + followed by 7-15 digits
  const isValid = /^\+[1-9]\d{7,14}$/.test(e164)

  return { isValid, normalized, e164 }
}

// =====================================================
// Contact Operations
// =====================================================

/**
 * Create a single contact
 */
export async function createContact(
  tenantId: string,
  params: CreateContactParams
): Promise<Contact> {
  const collRef = adminDb.collection(Collections.whatsappContacts(tenantId))

  const { isValid, normalized, e164 } = validatePhoneNumber(params.phoneNumber)

  if (!isValid) {
    throw new Error(
      `Invalid phone number format: ${params.phoneNumber}. Must be E.164 format (e.g., +1234567890)`
    )
  }

  // Check for duplicate phone number
  const existingSnap = await collRef
    .where('phoneNumberNormalized', '==', normalized)
    .limit(1)
    .get()

  if (!existingSnap.empty) {
    throw new Error('Contact with this phone number already exists.')
  }

  const now = new Date().toISOString()
  const docRef = collRef.doc()
  const contact: Contact = {
    id: docRef.id,
    tenantId,
    phoneNumber: e164,
    phoneNumberNormalized: normalized,
    name: params.name,
    email: params.email,
    optedIn: params.optedIn,
    optedInAt: params.optedIn ? now : undefined,
    optInSource: params.optInSource || 'manual',
    customFields: params.customFields || {},
    tags: params.tags || [],
    listIds: [],
    source: 'manual',
    createdAt: now,
    updatedAt: now,
  }

  await docRef.set(contact)

  return contact
}

/**
 * Import contacts from CSV
 * Supports columns: phone_number, name, email, opted_in, tags, custom_fields
 */
export async function importContacts(params: {
  tenantId: string
  csvContent: string
  listId?: string
  autoOptIn?: boolean
  userId: string
}): Promise<ImportResult> {
  const collRef = adminDb.collection(
    Collections.whatsappContacts(params.tenantId)
  )

  // Parse CSV
  const records = parse(params.csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  })

  const errors: string[] = []
  const contactIds: string[] = []

  for (let i = 0; i < records.length; i++) {
    const record = records[i]

    try {
      // Validate required field
      if (!record.phone_number) {
        errors.push(`Row ${i + 1}: Missing phone_number`)
        continue
      }

      const { isValid, normalized, e164 } = validatePhoneNumber(
        record.phone_number
      )

      if (!isValid) {
        errors.push(
          `Row ${i + 1}: Invalid phone number "${record.phone_number}"`
        )
        continue
      }

      // Parse custom fields if present
      let customFields = {}
      if (record.custom_fields) {
        try {
          customFields = JSON.parse(record.custom_fields)
        } catch {
          errors.push(`Row ${i + 1}: Invalid JSON in custom_fields`)
          continue
        }
      }

      // Parse tags if present
      let tags: string[] = []
      if (record.tags) {
        tags = record.tags.split(',').map((t: string) => t.trim())
      }

      const now = new Date().toISOString()

      // Check for existing contact (upsert)
      const existingSnap = await collRef
        .where('phoneNumberNormalized', '==', normalized)
        .limit(1)
        .get()

      let contactId: string

      if (!existingSnap.empty) {
        // Update existing contact
        const existingDoc = existingSnap.docs[0]
        contactId = existingDoc.id
        await existingDoc.ref.update({
          name: record.name || undefined,
          email: record.email || undefined,
          optedIn: params.autoOptIn || record.opted_in === 'true',
          optedInAt: params.autoOptIn ? now : undefined,
          optInSource: 'import',
          customFields,
          tags,
          source: 'import',
          updatedAt: now,
        })
      } else {
        // Create new contact
        const docRef = collRef.doc()
        contactId = docRef.id
        const contact: Contact = {
          id: docRef.id,
          tenantId: params.tenantId,
          phoneNumber: e164,
          phoneNumberNormalized: normalized,
          name: record.name || undefined,
          email: record.email || undefined,
          optedIn: params.autoOptIn || record.opted_in === 'true',
          optedInAt: params.autoOptIn ? now : undefined,
          optInSource: 'import',
          customFields,
          tags,
          listIds: [],
          source: 'import',
          createdAt: now,
          updatedAt: now,
        }
        await docRef.set(contact)
      }

      contactIds.push(contactId)

      // Add to list if specified (denormalized)
      if (params.listId) {
        // Add listId to contact's listIds
        await collRef.doc(contactId).update({
          listIds: FieldValue.arrayUnion(params.listId),
        })
        // Add contactId to list's contactIds
        await adminDb
          .collection(Collections.whatsappContactLists(params.tenantId))
          .doc(params.listId)
          .update({
            contactIds: FieldValue.arrayUnion(contactId),
          })
      }
    } catch (err: any) {
      errors.push(`Row ${i + 1}: ${err.message}`)
    }
  }

  return {
    imported: contactIds.length,
    errors,
    contactIds,
  }
}

/**
 * Update opt-in status for a contact
 */
export async function updateOptInStatus(
  tenantId: string,
  contactId: string,
  optedIn: boolean
): Promise<void> {
  const updateData: Record<string, any> = {
    optedIn,
    updatedAt: new Date().toISOString(),
  }

  if (optedIn) {
    updateData.optedInAt = new Date().toISOString()
    updateData.optedOutAt = FieldValue.delete()
  } else {
    updateData.optedOutAt = new Date().toISOString()
  }

  await adminDb
    .collection(Collections.whatsappContacts(tenantId))
    .doc(contactId)
    .update(updateData)
}

/**
 * List contacts for a tenant
 */
export async function listContacts(
  tenantId: string,
  filters?: {
    optedIn?: boolean
    tags?: string[]
    search?: string
    limit?: number
    offset?: number
  }
): Promise<{ contacts: Contact[]; total: number }> {
  let query: FirebaseFirestore.Query = adminDb.collection(
    Collections.whatsappContacts(tenantId)
  )

  // Apply filters
  if (filters?.optedIn !== undefined) {
    query = query.where('optedIn', '==', filters.optedIn)
  }

  if (filters?.tags && filters.tags.length > 0) {
    query = query.where('tags', 'array-contains-any', filters.tags)
  }

  query = query.orderBy('createdAt', 'desc')

  // Get total count (we need to run a separate count query or fetch all)
  const countSnap = await query.count().get()
  const total = countSnap.data().count

  // Apply pagination
  if (filters?.offset) {
    // Firestore offset using startAfter requires a cursor document
    // For simplicity we use offset() which is available in admin SDK
    query = query.offset(filters.offset)
  }

  if (filters?.limit) {
    query = query.limit(filters.limit)
  }

  const snap = await query.get()
  let contacts = snap.docs.map(doc => doc.data() as Contact)

  // Client-side search filter (Firestore doesn't support ilike)
  if (filters?.search) {
    const search = filters.search.toLowerCase()
    contacts = contacts.filter(
      c =>
        c.name?.toLowerCase().includes(search) ||
        c.phoneNumber.toLowerCase().includes(search) ||
        c.email?.toLowerCase().includes(search)
    )
  }

  return { contacts, total }
}

/**
 * Get a single contact by ID
 */
export async function getContactById(
  tenantId: string,
  contactId: string
): Promise<Contact | null> {
  const snap = await adminDb
    .collection(Collections.whatsappContacts(tenantId))
    .doc(contactId)
    .get()

  if (!snap.exists) {
    return null
  }

  return snap.data() as Contact
}

/**
 * Delete a contact (GDPR compliance)
 */
export async function deleteContact(
  tenantId: string,
  contactId: string
): Promise<void> {
  // Get contact to find list memberships
  const contactSnap = await adminDb
    .collection(Collections.whatsappContacts(tenantId))
    .doc(contactId)
    .get()

  if (contactSnap.exists) {
    const contact = contactSnap.data() as Contact
    // Remove contact from all lists it belongs to
    if (contact.listIds && contact.listIds.length > 0) {
      const batch = adminDb.batch()
      for (const listId of contact.listIds) {
        const listRef = adminDb
          .collection(Collections.whatsappContactLists(tenantId))
          .doc(listId)
        batch.update(listRef, {
          contactIds: FieldValue.arrayRemove(contactId),
        })
      }
      await batch.commit()
    }
  }

  await adminDb
    .collection(Collections.whatsappContacts(tenantId))
    .doc(contactId)
    .delete()
}

// =====================================================
// Contact List Operations
// =====================================================

/**
 * Create contact list
 */
export async function createContactList(params: {
  tenantId: string
  name: string
  description?: string
  contactIds?: string[]
  userId: string
}): Promise<ContactList> {
  const collRef = adminDb.collection(
    Collections.whatsappContactLists(params.tenantId)
  )

  const now = new Date().toISOString()
  const docRef = collRef.doc()
  const list: ContactList = {
    id: docRef.id,
    tenantId: params.tenantId,
    name: params.name,
    description: params.description,
    contactIds: params.contactIds || [],
    totalContacts: params.contactIds?.length || 0,
    optedInCount: 0,
    tags: [],
    createdBy: params.userId,
    createdAt: now,
    updatedAt: now,
  }

  await docRef.set(list)

  // Update each contact's listIds
  if (params.contactIds && params.contactIds.length > 0) {
    const batch = adminDb.batch()
    for (const contactId of params.contactIds) {
      const contactRef = adminDb
        .collection(Collections.whatsappContacts(params.tenantId))
        .doc(contactId)
      batch.update(contactRef, {
        listIds: FieldValue.arrayUnion(docRef.id),
      })
    }
    await batch.commit()
  }

  return list
}

/**
 * List contact lists for a tenant
 */
export async function listContactLists(
  tenantId: string
): Promise<ContactList[]> {
  const snap = await adminDb
    .collection(Collections.whatsappContactLists(tenantId))
    .orderBy('createdAt', 'desc')
    .get()

  return snap.docs.map(doc => doc.data() as ContactList)
}

/**
 * Get contacts in a list
 */
export async function getListContacts(
  tenantId: string,
  listId: string
): Promise<Contact[]> {
  const snap = await adminDb
    .collection(Collections.whatsappContacts(tenantId))
    .where('listIds', 'array-contains', listId)
    .get()

  return snap.docs.map(doc => doc.data() as Contact)
}

/**
 * Add contacts to a list
 */
export async function addContactsToList(
  tenantId: string,
  listId: string,
  contactIds: string[],
  userId: string
): Promise<void> {
  const batch = adminDb.batch()

  // Update each contact's listIds
  for (const contactId of contactIds) {
    const contactRef = adminDb
      .collection(Collections.whatsappContacts(tenantId))
      .doc(contactId)
    batch.update(contactRef, {
      listIds: FieldValue.arrayUnion(listId),
    })
  }

  // Update the list's contactIds
  const listRef = adminDb
    .collection(Collections.whatsappContactLists(tenantId))
    .doc(listId)
  for (const contactId of contactIds) {
    batch.update(listRef, {
      contactIds: FieldValue.arrayUnion(contactId),
    })
  }

  await batch.commit()

  // Update contact count
  await updateContactListCounts(tenantId, listId)
}

/**
 * Remove contacts from a list
 */
export async function removeContactsFromList(
  tenantId: string,
  listId: string,
  contactIds: string[]
): Promise<void> {
  const batch = adminDb.batch()

  // Remove listId from each contact's listIds
  for (const contactId of contactIds) {
    const contactRef = adminDb
      .collection(Collections.whatsappContacts(tenantId))
      .doc(contactId)
    batch.update(contactRef, {
      listIds: FieldValue.arrayRemove(listId),
    })
  }

  // Remove contactIds from the list's contactIds
  const listRef = adminDb
    .collection(Collections.whatsappContactLists(tenantId))
    .doc(listId)
  for (const contactId of contactIds) {
    batch.update(listRef, {
      contactIds: FieldValue.arrayRemove(contactId),
    })
  }

  await batch.commit()

  // Update contact count
  await updateContactListCounts(tenantId, listId)
}

/**
 * Update contact list counts (total and opted-in)
 */
export async function updateContactListCounts(
  tenantId: string,
  listId: string
): Promise<void> {
  // Get all contacts in list
  const contacts = await getListContacts(tenantId, listId)

  const totalContacts = contacts.length
  const optedInCount = contacts.filter(c => c.optedIn).length

  await adminDb
    .collection(Collections.whatsappContactLists(tenantId))
    .doc(listId)
    .update({
      totalContacts,
      optedInCount,
      updatedAt: new Date().toISOString(),
    })
}

/**
 * Delete contact list
 */
export async function deleteContactList(
  tenantId: string,
  listId: string
): Promise<void> {
  // Remove listId from all contacts that belong to this list
  const contacts = await getListContacts(tenantId, listId)
  if (contacts.length > 0) {
    const batch = adminDb.batch()
    for (const contact of contacts) {
      const contactRef = adminDb
        .collection(Collections.whatsappContacts(tenantId))
        .doc(contact.id)
      batch.update(contactRef, {
        listIds: FieldValue.arrayRemove(listId),
      })
    }
    await batch.commit()
  }

  await adminDb
    .collection(Collections.whatsappContactLists(tenantId))
    .doc(listId)
    .delete()
}
