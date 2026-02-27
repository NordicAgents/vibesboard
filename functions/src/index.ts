/**
 * Cloud Functions for VibeAgent
 *
 * Phase 6 of Supabase -> Firebase migration.
 * These functions replace:
 *   1. create_or_get_personal_tenant RPC  -> onUserCreated (Auth trigger)
 *   2. File processing background jobs    -> onFileCreated (Firestore trigger)
 *   3. WhatsApp queue cron endpoint       -> processWhatsAppQueue (scheduled)
 *   4. Campaign counter updates           -> onMessageStatusUpdate (Firestore trigger)
 */

export { onUserCreated } from "./on-user-created";
export { onFileCreated } from "./on-file-created";
export { processWhatsAppQueue } from "./process-whatsapp-queue";
export { onMessageStatusUpdate } from "./on-message-status-update";
