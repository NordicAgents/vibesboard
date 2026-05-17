import { firestore } from "firebase-functions/v2";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";

if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();

/**
 * onFileCreated
 *
 * Fires when a new document is created in any agent's files sub-collection.
 * Path: tenants/{tenantId}/agents/{agentId}/files/{fileId}
 *
 * If the file has status "pending", this function transitions it to
 * "processing" so the main application (or a separate Cloud Run job)
 * can pick it up for full ingestion (PDF parsing, DOCX extraction,
 * vision OCR, chunking, embedding, etc.).
 *
 * Heavy processing is intentionally kept outside this lightweight trigger
 * because it requires large dependencies (pdf-parse, mammoth, OpenAI SDK)
 * that would bloat the Cloud Functions bundle. The actual ingestion is
 * handled by the Next.js app's /api/agents/[id]/files/ingest endpoint
 * or via the admin panel's "Reprocess" action.
 */
export const onFileCreated = firestore.onDocumentCreated(
  "tenants/{tenantId}/agents/{agentId}/files/{fileId}",
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("No data in event, skipping.");
      return;
    }

    const data = snapshot.data();
    const { tenantId, agentId, fileId } = event.params;

    // Only act on files that arrive with status "pending"
    if (data.status !== "pending") {
      console.log(
        `File ${fileId} has status "${data.status}", not "pending". Skipping.`
      );
      return;
    }

    const now = new Date().toISOString();

    try {
      // Transition to "processing" so the main app knows to pick it up
      await snapshot.ref.update({
        status: "processing",
        processingStartedAt: now,
        updatedAt: now,
      });

      console.log(
        `File ${fileId} (agent ${agentId}, tenant ${tenantId}) marked as processing. ` +
          `fileName=${data.fileName}, mimeType=${data.mimeType}, fileSize=${data.fileSize}`
      );

      // TODO: Optionally call the main app's ingest endpoint here:
      //
      //   const appUrl = process.env.APP_URL; // e.g. https://vibeagent.app
      //   await fetch(`${appUrl}/api/agents/${agentId}/files/ingest`, {
      //     method: "POST",
      //     headers: {
      //       "Content-Type": "application/json",
      //       "x-internal-secret": process.env.INTERNAL_SECRET,
      //     },
      //     body: JSON.stringify({ tenantId, agentId, fileId }),
      //   });
      //
      // For now the main app polls for files with status "processing",
      // or operators trigger ingestion from the admin panel.
    } catch (error) {
      console.error(
        `Failed to mark file ${fileId} as processing:`,
        error
      );

      // Attempt to record the failure on the document
      try {
        await db
          .doc(
            `tenants/${tenantId}/agents/${agentId}/files/${fileId}`
          )
          .update({
            status: "failed",
            processingError:
              error instanceof Error
                ? error.message
                : "Unknown error in onFileCreated trigger",
            updatedAt: new Date().toISOString(),
          });
      } catch (innerError) {
        console.error(
          "Additionally failed to write error status:",
          innerError
        );
      }
    }
  }
);
