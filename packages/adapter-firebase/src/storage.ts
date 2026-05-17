import 'server-only'
import { adminStorage } from './admin'

/**
 * Raw GCS bucket handle — used by branding-logo routes that need GCS-native
 * APIs (file.save, file.download, file.getMetadata).
 *
 * File-operation helpers (getSignedUploadUrl, getSignedDownloadUrl,
 * downloadFile, deleteFile, fileExists) have moved to @vibesboard/adapter-s3.
 */
export const bucket = adminStorage.bucket()
