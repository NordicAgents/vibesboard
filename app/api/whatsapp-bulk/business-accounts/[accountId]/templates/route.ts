import { NextRequest, NextResponse } from 'next/server';
import {
  createMessageTemplate,
  listTemplates,
  validateTemplate,
} from '@/lib/whatsapp-bulk/templates';
import { createClient } from '@/lib/supabase/server';

/**
 * GET - List templates for a business account
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { accountId: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as 'pending' | 'approved' | 'rejected' | undefined;

    const templates = await listTemplates(params.accountId, status);

    return NextResponse.json({ templates });
  } catch (error: any) {
    console.error('Failed to list templates:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to list templates' },
      { status: 500 }
    );
  }
}

/**
 * POST - Create a new template
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { accountId: string } }
) {
  try {
    const body = await request.json();

    // Validate template before submission
    const validation = validateTemplate({
      businessAccountId: params.accountId,
      ...body,
    });

    if (!validation.isValid) {
      return NextResponse.json(
        {
          error: 'Template validation failed',
          validationErrors: validation.errors,
        },
        { status: 400 }
      );
    }

    const template = await createMessageTemplate({
      businessAccountId: params.accountId,
      name: body.name,
      category: body.category,
      language: body.language || 'en',
      bodyText: body.bodyText,
      headerType: body.headerType,
      headerText: body.headerText,
      headerMediaUrl: body.headerMediaUrl,
      footerText: body.footerText,
      variables: body.variables,
      buttons: body.buttons,
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (error: any) {
    console.error('Failed to create template:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create template' },
      { status: 500 }
    );
  }
}
