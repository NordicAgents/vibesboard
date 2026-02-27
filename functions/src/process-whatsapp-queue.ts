import { scheduler } from "firebase-functions/v2";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";

if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();

// ─── Configuration ───────────────────────────────────────────────────

/** Number of pending messages to grab per invocation */
const BATCH_SIZE = 20;

// ─── Cloud Function ──────────────────────────────────────────────────

/**
 * processWhatsAppQueue
 *
 * Runs on a Cloud Scheduler cadence (every 1 minute).
 * Queries the message_queue collection group for items with status
 * "pending", sends them via the Meta WhatsApp Business API, and
 * updates their status + campaign counters.
 *
 * This replaces the Vercel cron endpoint that previously called
 * lib/whatsapp-bulk/queue-processor.ts -> processMessageQueue().
 */
export const processWhatsAppQueue = scheduler.onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "UTC",
    retryCount: 0, // Don't retry the whole schedule; items are idempotent
  },
  async (_event) => {
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    try {
      // Fetch pending messages across all tenants/campaigns
      const messagesSnap = await db
        .collectionGroup("message_queue")
        .where("status", "==", "pending")
        .orderBy("createdAt")
        .limit(BATCH_SIZE)
        .get();

      if (messagesSnap.empty) {
        console.log("No pending messages in queue.");
        return;
      }

      console.log(
        `Found ${messagesSnap.size} pending message(s) to process.`
      );

      for (const doc of messagesSnap.docs) {
        processed++;

        try {
          await processQueueItem(doc);
          succeeded++;
        } catch (error) {
          console.error(
            `Failed to process queue item ${doc.id}:`,
            error
          );
          failed++;
        }
      }
    } catch (error) {
      console.error("Queue processing error:", error);
    }

    console.log(
      `Queue run complete: processed=${processed} succeeded=${succeeded} failed=${failed}`
    );
  }
);

// ─── Queue Item Processing ───────────────────────────────────────────

/**
 * Process a single message queue item.
 *
 * Document path: tenants/{tenantId}/whatsapp_campaigns/{campaignId}/message_queue/{docId}
 */
async function processQueueItem(
  doc: FirebaseFirestore.QueryDocumentSnapshot
): Promise<void> {
  const message = doc.data();
  const now = new Date().toISOString();

  // Extract tenantId and campaignId from the document path
  const pathParts = doc.ref.path.split("/");
  const tenantId = pathParts[1];
  const campaignId = pathParts[3];

  // ── Optimistic lock: only proceed if still pending ──
  const currentSnap = await doc.ref.get();
  const currentData = currentSnap.data();
  if (!currentData || currentData.status !== "pending") {
    console.log(`Item ${doc.id} no longer pending, skipping.`);
    return;
  }

  // Mark as processing
  await doc.ref.update({
    status: "processing",
    attempts: FieldValue.increment(1),
    updatedAt: now,
  });

  // ── Fetch business account ──
  const accountSnap = await db
    .doc(
      `tenants/${tenantId}/whatsapp_business_accounts/${message.businessAccountId}`
    )
    .get();

  if (!accountSnap.exists) {
    await markFailed(doc, tenantId, campaignId, "Business account not found");
    return;
  }

  const account = accountSnap.data()!;

  if (account.status === "disconnected") {
    await markFailed(
      doc,
      tenantId,
      campaignId,
      "WhatsApp Business account is disconnected"
    );
    return;
  }

  // ── Send message via Meta API ──
  try {
    // TODO: Integrate Meta WhatsApp Business API
    //
    // The full implementation should:
    //   1. Decrypt the access token: decryptToken(account.accessToken)
    //   2. Call sendTemplateMessage() with:
    //        - phoneNumberId: account.phoneNumberId
    //        - accessToken (decrypted)
    //        - to: message.toPhoneNumber
    //        - templateName: message.templateName
    //        - language: message.templateLanguage
    //        - variables: message.templateVariables
    //   3. Store the returned WhatsApp message ID
    //
    // For now we log the intent and mark as sent for development.
    // Uncomment and adapt the block below once dependencies are
    // bundled into the functions package:
    //
    // const accessToken = decryptToken(account.accessToken);
    // const sendResult = await sendTemplateMessage({ ... });
    // const whatsappMessageId = sendResult.messageId;

    console.log(
      `[DRY-RUN] Would send template "${message.templateName}" ` +
        `to ${message.toPhoneNumber} via account ${message.businessAccountId}`
    );

    // TODO: Replace this stub with real send result once Meta API is wired up
    const whatsappMessageId = `stub_${doc.id}`;

    await doc.ref.update({
      status: "sent",
      messageId: whatsappMessageId,
      sentAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Increment campaign sent counter, decrement pending
    await updateCampaignCounter(tenantId, campaignId, "messagesSent");
  } catch (error) {
    const attempts = (message.attempts || 0) + 1;
    const maxAttempts = message.maxAttempts || 3;
    const isLastAttempt = attempts >= maxAttempts;

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    const updateData: Record<string, any> = {
      status: isLastAttempt ? "failed" : "pending",
      error: errorMessage,
      updatedAt: new Date().toISOString(),
    };

    if (isLastAttempt) {
      updateData.failedAt = new Date().toISOString();
    }

    await doc.ref.update(updateData);

    if (isLastAttempt) {
      await updateCampaignCounter(tenantId, campaignId, "messagesFailed");
    }

    throw error;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Mark a queue item as failed and bump the campaign's failure counter.
 */
async function markFailed(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  tenantId: string,
  campaignId: string,
  reason: string
): Promise<void> {
  await doc.ref.update({
    status: "failed",
    failedAt: new Date().toISOString(),
    error: reason,
    updatedAt: new Date().toISOString(),
  });

  await updateCampaignCounter(tenantId, campaignId, "messagesFailed");
}

/**
 * Atomically increment a campaign counter and decrement messagesPending.
 */
async function updateCampaignCounter(
  tenantId: string,
  campaignId: string,
  field: "messagesSent" | "messagesFailed" | "messagesDelivered" | "messagesRead"
): Promise<void> {
  const campaignRef = db
    .collection(`tenants/${tenantId}/whatsapp_campaigns`)
    .doc(campaignId);

  await campaignRef.update({
    [field]: FieldValue.increment(1),
    messagesPending: FieldValue.increment(-1),
    updatedAt: new Date().toISOString(),
  });
}
