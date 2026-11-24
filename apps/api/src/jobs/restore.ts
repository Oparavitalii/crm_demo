// Inverts jobs/backup.ts: fetches an encrypted backup object from R2,
// decrypts it, and writes the plain .sql to disk. Deliberately does NOT
// apply the SQL to any database — restoring is a decision a human makes,
// and a script that can overwrite a database is a script that eventually
// will. Run `psql <target-url> -f <output>` yourself after reviewing it.
//
// Usage: node dist/jobs/restore.js <r2-object-key|latest> <output-sql-path>
import { writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { env } from '../env';
import { logger } from '../lib/logger';
import { decryptBackup } from './backup-crypto';

const s3 = new S3Client({
  region: env.R2_REGION,
  endpoint: env.R2_ENDPOINT,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY,
    secretAccessKey: env.R2_SECRET_KEY,
  },
});

// Newest object under backups/, by LastModified. Exists so an incident does
// not start with someone reading timestamps off a bucket listing under
// pressure — `restore.js latest` is one less thing to get wrong at 3am, and
// it is what the restore drill uses.
//
// No pagination: retention is 30 days (backup.ts RETENTION_DAYS) so the
// listing is ~30 objects against a 1000-key page. If retention ever grows past
// that, this silently starts ignoring the tail and must be paginated.
async function findLatestBackupKey(): Promise<string> {
  const list = await s3.send(
    new ListObjectsV2Command({ Bucket: env.R2_BUCKET, Prefix: 'backups/' }),
  );
  const newest = (list.Contents ?? [])
    .filter((o) => o.Key !== undefined && o.LastModified !== undefined)
    .sort((a, b) => b.LastModified!.getTime() - a.LastModified!.getTime())[0];

  if (!newest?.Key) {
    throw new Error(`no objects under backups/ in bucket ${env.R2_BUCKET}`);
  }
  logger.info({ key: newest.Key, lastModified: newest.LastModified }, 'Resolved "latest"');
  return newest.Key;
}

async function runRestore(): Promise<void> {
  const keyArg = process.argv[2];
  const outputPath = process.argv[3];

  if (!keyArg || !outputPath) {
    logger.error('Usage: node dist/jobs/restore.js <r2-object-key|latest> <output-sql-path>');
    process.exit(1);
  }

  if (!env.BACKUP_ENCRYPTION_KEY) {
    logger.error('BACKUP_ENCRYPTION_KEY not set — refusing to run restore');
    process.exit(1);
  }

  const objectKey = keyArg === 'latest' ? await findLatestBackupKey() : keyArg;

  logger.info({ objectKey, outputPath }, 'Restore started');

  const response = await s3.send(
    new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: objectKey }),
  );
  if (!response.Body) {
    throw new Error(`object ${objectKey} has no body`);
  }
  const body = Buffer.from(await response.Body.transformToByteArray());

  const sql = gunzipSync(decryptBackup(body, env.BACKUP_ENCRYPTION_KEY));

  // 0600, not the default 0644. What lands here is every candidate's personal
  // data in plaintext — the one moment in this system's life when the PII sits
  // unencrypted on a disk. Restores happen on laptops and shared jump boxes.
  // Note the mode only applies when the file is created: if outputPath already
  // exists, its existing permissions win. Write to a fresh path.
  writeFileSync(outputPath, sql, { mode: 0o600 });

  logger.info(
    { objectKey, outputPath, sizeBytes: sql.length },
    'Restore written to disk — SQL NOT applied, review before running psql',
  );
}

runRestore().catch((err: unknown) => {
  logger.error({ err }, 'Restore failed');
  process.exit(1);
});
