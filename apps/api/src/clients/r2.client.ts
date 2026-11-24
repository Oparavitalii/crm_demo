// Cloudflare R2 client (S3-compatible API). Single global instance.
// Use this whenever you need to delete or sign files in the CRM's R2 bucket.
// For backup uploads (different prefix, different lifecycle) see jobs/backup.ts.

// `import type` is erased at compile time — it costs nothing at runtime and
// exists only so the lazily-loaded module can be typed below.
import type { S3Client } from '@aws-sdk/client-s3';
import { env } from '../env';
import { logger } from '../lib/logger';
import { ForbiddenError } from '../lib/errors';

// Public demo has no bucket at all: uploads and downloads are refused with a
// clear 403 instead of failing deep inside the AWS SDK, and deletes are no-ops.
const DEMO_STORAGE_DISABLED = 'disabled_in_demo';

interface R2 {
  client: S3Client;
  s3: typeof import('@aws-sdk/client-s3');
  presign: typeof import('@aws-sdk/s3-request-presigner').getSignedUrl;
}

let r2Promise: Promise<R2> | null = null;

// The AWS SDK is loaded on first use, not at boot. index.ts imports every
// router eagerly, so a static import here made the whole SDK resident in every
// API process from startup — for a client that only runs when a file is
// deleted, uploaded or presigned.
//
// Cached in a module-level promise so concurrent callers share one
// initialisation. A rejected import clears the cache rather than poisoning
// every later call with the same failure.
async function getR2(): Promise<R2> {
  if (!r2Promise) {
    r2Promise = (async () => {
      const s3 = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      const client = new s3.S3Client({
        region: env.R2_REGION,
        endpoint: env.R2_ENDPOINT,
        credentials: {
          accessKeyId: env.R2_ACCESS_KEY,
          secretAccessKey: env.R2_SECRET_KEY,
        },
      });
      return { client, s3, presign: getSignedUrl };
    })().catch((err: unknown) => {
      r2Promise = null;
      throw err;
    });
  }
  return r2Promise;
}

// Extracts the object key from an R2 URL. Supports:
//   - Plain key:          "candidates/abc/cv.pdf"
//   - Full URL:           "https://<endpoint>/<bucket>/candidates/abc/cv.pdf"
//   - Public domain URL:  "https://files.crm-demo.example/candidates/abc/cv.pdf"
export function extractObjectKey(urlOrKey: string): string | null {
  if (!urlOrKey) return null;
  if (!urlOrKey.startsWith('http')) return urlOrKey;
  try {
    const u = new URL(urlOrKey);
    // Drop the leading slash and any bucket prefix.
    const path = u.pathname.replace(/^\/+/, '');
    if (path.startsWith(`${env.R2_BUCKET}/`)) {
      return path.slice(env.R2_BUCKET.length + 1);
    }
    return path;
  } catch {
    return null;
  }
}

// Best-effort delete. Logs but does not throw — RODO erasure of DB row should
// not be blocked by a transient R2 outage; orphan files can be reaped later.
export async function deleteObject(urlOrKey: string): Promise<{ deleted: boolean }> {
  if (env.DEMO_MODE) return { deleted: false };
  const key = extractObjectKey(urlOrKey);
  if (!key) {
    logger.warn({ urlOrKey }, 'r2_delete_skip_unrecognized_key');
    return { deleted: false };
  }
  try {
    const { client, s3 } = await getR2();
    await client.send(new s3.DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
    return { deleted: true };
  } catch (err) {
    logger.error({ err, key }, 'r2_delete_failed');
    return { deleted: false };
  }
}

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
}

export async function putObject(input: PutObjectInput): Promise<void> {
  if (env.DEMO_MODE) throw new ForbiddenError(DEMO_STORAGE_DISABLED);
  const { client, s3 } = await getR2();
  await client.send(
    new s3.PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
}

// Generates a short-lived presigned URL (TTL = 300s) for reading a document
// PDF. Each request gets a fresh URL — no caching at the client side.
export async function presignGet(key: string, ttlSeconds = 300): Promise<string> {
  if (env.DEMO_MODE) throw new ForbiddenError(DEMO_STORAGE_DISABLED);
  const { client, s3, presign } = await getR2();
  return presign(
    client,
    new s3.GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
    { expiresIn: ttlSeconds },
  );
}
