import { spawn } from 'node:child_process';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { env } from '../env';
import { logger } from '../lib/logger';
import { encryptBackup } from './backup-crypto';

const s3 = new S3Client({
  region: env.R2_REGION,
  endpoint: env.R2_ENDPOINT,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY,
    secretAccessKey: env.R2_SECRET_KEY,
  },
});

const BACKUP_PREFIX = 'backups/';
const RETENTION_DAYS = 30;

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function runBackup(): Promise<void> {
  if (!env.BACKUP_ENCRYPTION_KEY) {
    logger.error('BACKUP_ENCRYPTION_KEY not set — refusing to run backup');
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const key = `${BACKUP_PREFIX}opushr-${timestamp}.sql.gz.enc`;

  logger.info({ key }, 'Backup started');

  // Spawn pg_dump piped through gzip
  const dump = spawn('pg_dump', [
    env.DATABASE_URL_DIRECT,
    '--format=plain',
    '--no-owner',
    '--no-privileges',
  ]);
  const gzip = spawn('gzip', ['-9']);

  // The 'close' listeners must attach before the first await. Scheduled runs
  // #8 and #9 (2026-07-31, 2026-08-01) lost exactly this race: both children
  // had already emitted 'close' by the time streamToBuffer resolved, the
  // late-attached listeners below never fired, the event loop drained, and
  // node exited 0 right after "Backup started" — a green CI run that uploaded
  // nothing.
  const dumpClosed = new Promise<number | null>((r) => dump.once('close', r));
  const gzipClosed = new Promise<number | null>((r) => gzip.once('close', r));

  dump.stdout.pipe(gzip.stdin);

  // Capture stderr for diagnostics
  const dumpStderr: string[] = [];
  dump.stderr.on('data', (d: Buffer) => dumpStderr.push(d.toString()));

  // Buffer gzipped output
  const gzippedBuf = await streamToBuffer(gzip.stdout);

  // Wait for both processes to exit
  const [dumpExit, gzipExit] = await Promise.all([dumpClosed, gzipClosed]);

  if (dumpExit !== 0) {
    logger.error({ exitCode: dumpExit, stderr: dumpStderr.join('') }, 'pg_dump failed');
    throw new Error(`pg_dump exit ${dumpExit}`);
  }
  if (gzipExit !== 0) {
    throw new Error(`gzip exit ${gzipExit}`);
  }

  // AES-256-GCM, layout IV(12) | AuthTag(16) | Ciphertext. Shared with
  // restore.ts so the two provably invert each other — see jobs/backup-crypto.ts.
  const body = encryptBackup(gzippedBuf, env.BACKUP_ENCRYPTION_KEY);

  await s3.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/octet-stream',
    }),
  );

  logger.info({ key, sizeBytes: body.length }, 'Backup uploaded to R2');

  await cleanupOldBackups();

  logger.info('Backup completed successfully');
}

async function cleanupOldBackups(): Promise<void> {
  const list = await s3.send(
    new ListObjectsV2Command({ Bucket: env.R2_BUCKET, Prefix: BACKUP_PREFIX }),
  );

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);

  const toDelete = (list.Contents ?? []).filter(
    (o) => o.Key && o.LastModified !== undefined && o.LastModified < cutoff,
  );

  if (toDelete.length === 0) {
    logger.info('No old backups to delete');
    return;
  }

  await s3.send(
    new DeleteObjectsCommand({
      Bucket: env.R2_BUCKET,
      Delete: { Objects: toDelete.map((o) => ({ Key: o.Key! })) },
    }),
  );

  logger.info({ deleted: toDelete.length, cutoff: cutoff.toISOString() }, 'Old backups deleted');
}

// Belt and braces for the race above and any drain path not yet imagined:
// default the exit code to failure, and only a fully completed backup clears
// it. If the event loop ever empties before runBackup() resolves, the step
// goes red instead of minting a phantom success.
process.exitCode = 1;

runBackup()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err: unknown) => {
    logger.error({ err }, 'Backup failed');
    process.exit(1);
  });
