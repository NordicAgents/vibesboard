import 'server-only'
import { S3Client } from '@aws-sdk/client-s3'

function readEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`[adapter-s3] ${name} is not set. See .env.example.`)
  return v
}

let _client: S3Client | undefined

export function getS3Client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      endpoint: readEnv('S3_ENDPOINT'),
      region: process.env.S3_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: readEnv('S3_ACCESS_KEY_ID'),
        secretAccessKey: readEnv('S3_SECRET_ACCESS_KEY'),
      },
      // MinIO uses path-style. AWS/R2 use virtual-hosted (path-style: false).
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    })
  }
  return _client
}

export function getBucket(): string {
  return readEnv('S3_BUCKET')
}
