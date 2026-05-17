/**
 * Cloud Functions for VibeAgent
 *
 * Deployed automatically via GitHub Actions on push to dev (staging) and main (production).
 *
 * These functions replace:
 *   1. create_or_get_personal_tenant RPC  -> onUserCreated (Auth trigger)
 *   2. File processing background jobs    -> onFileCreated (Firestore trigger)
 */

export { onUserCreated } from "./on-user-created";
export { onFileCreated } from "./on-file-created";
