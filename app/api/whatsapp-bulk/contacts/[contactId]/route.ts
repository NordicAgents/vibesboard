import { NextRequest, NextResponse } from 'next/server';
import {
  getContactById,
  deleteContact,
  updateOptInStatus,
} from '@/lib/whatsapp-bulk/contacts';

/**
 * GET - Get a single contact
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { contactId: string } }
) {
  try {
    const contact = await getContactById(params.contactId);

    if (!contact) {
      return NextResponse.json(
        { error: 'Contact not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ contact });
  } catch (error: any) {
    console.error('Failed to fetch contact:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch contact' },
      { status: 500 }
    );
  }
}

/**
 * PATCH - Update contact (opt-in status)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { contactId: string } }
) {
  try {
    const body = await request.json();

    if (body.optedIn !== undefined) {
      await updateOptInStatus(params.contactId, body.optedIn);
    }

    const contact = await getContactById(params.contactId);

    return NextResponse.json({ contact });
  } catch (error: any) {
    console.error('Failed to update contact:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update contact' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Delete a contact (GDPR compliance)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { contactId: string } }
) {
  try {
    await deleteContact(params.contactId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete contact:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete contact' },
      { status: 500 }
    );
  }
}
