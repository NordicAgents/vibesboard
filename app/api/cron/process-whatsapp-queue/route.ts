import { NextRequest, NextResponse } from 'next/server';
import { processMessageQueue } from '@/lib/whatsapp-bulk/queue-processor';

/**
 * GET - Process WhatsApp message queue
 * Called by Vercel cron job every 30 seconds
 *
 * Cron configuration in vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/process-whatsapp-queue",
 *     "schedule": "* /30 * * * * *"
 *   }]
 * }
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;

    if (authHeader !== expectedAuth) {
      console.error('Unauthorized cron job attempt');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Process queue
    const result = await processMessageQueue(20); // Process 20 messages per run

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Queue processing error:', error);
    return NextResponse.json(
      { error: error.message || 'Queue processing failed' },
      { status: 500 }
    );
  }
}
