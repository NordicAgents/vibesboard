import { NextRequest, NextResponse } from 'next/server';
import {
  getBusinessAccountById,
  disconnectBusinessAccount,
  updateAccountDisplayName,
} from '@/lib/whatsapp-bulk/business-accounts';

/**
 * GET - Get a single business account
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { accountId: string } }
) {
  try {
    const account = await getBusinessAccountById(params.accountId);

    if (!account) {
      return NextResponse.json(
        { error: 'Business account not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ account });
  } catch (error: any) {
    console.error('Failed to fetch business account:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch business account' },
      { status: 500 }
    );
  }
}

/**
 * PATCH - Update business account
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { accountId: string } }
) {
  try {
    const body = await request.json();
    const { displayName } = body;

    if (displayName) {
      await updateAccountDisplayName(params.accountId, displayName);
    }

    const account = await getBusinessAccountById(params.accountId);

    return NextResponse.json({ account });
  } catch (error: any) {
    console.error('Failed to update business account:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update business account' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Disconnect business account
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { accountId: string } }
) {
  try {
    await disconnectBusinessAccount(params.accountId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to disconnect business account:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to disconnect business account' },
      { status: 500 }
    );
  }
}
