// S3 / MinIO helpers for integration tests.
//
// The adapter-s3 client reads S3_* env vars; test/setup/env.ts bakes localhost
// defaults that match docker-compose.dev.yml. ensureBucket() creates the bucket
// if it does not yet exist so file tests are self-sufficient.
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3'

export function testS3Client(): S3Client {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'vibesboard',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'vibesboard',
    },
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  })
}

/** Idempotently ensure the configured bucket exists. */
export async function ensureBucket(
  bucket = process.env.S3_BUCKET ?? 'vibesboard-files',
): Promise<void> {
  const client = testS3Client()
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }))
  } catch {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }))
    } catch {
      // Race or already-exists: ignore.
    }
  } finally {
    client.destroy()
  }
}
