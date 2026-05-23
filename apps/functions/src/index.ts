/**
 * Cloud Functions for VibeAgent
 *
 * Deployed automatically via GitHub Actions on push to dev (staging) and main (production).
 *
 * These functions replace:
 *   1. File processing background jobs    -> onFileCreated (Firestore trigger)
 */

export { onFileCreated } from "./on-file-created";
