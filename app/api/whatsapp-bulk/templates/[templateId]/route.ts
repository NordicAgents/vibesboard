import { NextRequest, NextResponse } from 'next/server';
import {
  getTemplateById,
  deleteTemplate,
} from '@/lib/whatsapp-bulk/templates';

/**
 * GET - Get a single template
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { templateId: string } }
) {
  try {
    const template = await getTemplateById(params.templateId);

    if (!template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ template });
  } catch (error: any) {
    console.error('Failed to fetch template:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch template' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Delete a template
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { templateId: string } }
) {
  try {
    await deleteTemplate(params.templateId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete template:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete template' },
      { status: 500 }
    );
  }
}
