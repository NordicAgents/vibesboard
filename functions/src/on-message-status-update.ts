import { firestore } from "firebase-functions/v2";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";

if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();

// ─── Types ───────────────────────────────────────────────────────────

type QueueItemStatus =
  | "pending"
  | "processing"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

/**
 * Status transitions that trigger campaign counter updates.
 * Maps "newStatus" to the campaign field that should be incremented
 * and whether messagesPending should be decremented.
 */
const STATUS_COUNTER_MAP: Record<
  string,
  {
    incrementField:
      | "messagesSent"
      | "messagesFailed"
      | "messagesDelivered"
      | "messagesRead";
    decrementPending: boolean;
  }
> = {
  sent: { incrementField: "messagesSent", decrementPending: true },
  failed: { incrementField: "messagesFailed", decrementPending: true },
  delivered: { incrementField: "messagesDelivered", decrementPending: false },
  read: { incrementField: "messagesRead", decrementPending: false },
};

// ─── Cloud Function ──────────────────────────────────────────────────

/**
 * onMessageStatusUpdate
 *
 * Fires when a document in the message_queue sub-collection is updated.
 * Path: tenants/{tenantId}/whatsapp_campaigns/{campaignId}/message_queue/{messageId}
 *
 * When the status field changes, this function atomically updates the
 * parent campaign's aggregate counters using FieldValue.increment() so
 * that concurrent updates never cause counter drift.
 *
 * Handled transitions:
 *   pending/processing -> sent       : +messagesSent,      -messagesPending
 *   pending/processing -> failed     : +messagesFailed,    -messagesPending
 *   sent              -> delivered   : +messagesDelivered
 *   sent/delivered    -> read        : +messagesRead
 */
export const onMessageStatusUpdate = firestore.onDocumentUpdated(
  "tenants/{tenantId}/whatsapp_campaigns/{campaignId}/message_queue/{messageId}",
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    if (!beforeData || !afterData) {
      console.log("Missing before/after data, skipping.");
      return;
    }

    const oldStatus: QueueItemStatus = beforeData.status;
    const newStatus: QueueItemStatus = afterData.status;

    // Nothing to do if the status didn't change
    if (oldStatus === newStatus) {
      return;
    }

    const { tenantId, campaignId, messageId } = event.params;

    // Look up what counter action to take for this new status
    const action = STATUS_COUNTER_MAP[newStatus];
    if (!action) {
      // No counter update needed for this transition (e.g. pending -> processing)
      return;
    }

    // Guard against duplicate counter bumps.
    // "sent" and "failed" should only be counted when transitioning FROM
    // pending or processing. "delivered" only from sent. "read" from
    // sent or delivered. This prevents re-counting if a document is
    // updated multiple times with the same status.
    const validPriorStatuses: Record<string, QueueItemStatus[]> = {
      sent: ["pending", "processing"],
      failed: ["pending", "processing"],
      delivered: ["sent"],
      read: ["sent", "delivered"],
    };

    const allowed = validPriorStatuses[newStatus];
    if (allowed && !allowed.includes(oldStatus)) {
      console.log(
        `Ignoring ${oldStatus} -> ${newStatus} for message ${messageId} ` +
          `(not a valid counter transition).`
      );
      return;
    }

    // Build the atomic update
    const campaignRef = db
      .collection(`tenants/${tenantId}/whatsapp_campaigns`)
      .doc(campaignId);

    const updateData: Record<string, any> = {
      [action.incrementField]: FieldValue.increment(1),
      updatedAt: new Date().toISOString(),
    };

    if (action.decrementPending) {
      updateData.messagesPending = FieldValue.increment(-1);
    }

    try {
      await campaignRef.update(updateData);

      console.log(
        `Campaign ${campaignId}: ${action.incrementField} +1` +
          (action.decrementPending ? ", messagesPending -1" : "") +
          ` (message ${messageId}: ${oldStatus} -> ${newStatus})`
      );
    } catch (error) {
      console.error(
        `Failed to update campaign ${campaignId} counters for ` +
          `message ${messageId} (${oldStatus} -> ${newStatus}):`,
        error
      );
    }
  }
);
