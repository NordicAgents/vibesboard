/**
 * Cloud Functions for VibeAgent
 *
 * These functions replace:
 *   1. create_or_get_personal_tenant RPC  -> onUserCreated (Auth trigger)
 *   2. File processing background jobs    -> onFileCreated (Firestore trigger)
 */

export { onUserCreated } from "./on-user-created";
export { onFileCreated } from "./on-file-created";
