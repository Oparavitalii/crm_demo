/**
 * restore.job.test.ts
 *
 * Proves the restore path inverts the backup path — using the REAL functions
 * both jobs run, not copies of them. `jobs/backup-crypto.ts` is deliberately
 * free of env/S3/logger imports so it loads in a unit test with no network,
 * no database, and no argv.
 *
 * This matters more than it looks: an earlier version of this file mirrored
 * the offsets locally, which meant every assertion here would still have
 * passed with `restore.ts` reading the auth tag from the wrong bytes. A
 * backup you cannot restore is worse than no backup — it produces confidence
 * without protection — and a test that cannot detect that is the same trap one
 * level down.
 */
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { decryptBackup, encryptBackup } from '../jobs/backup-crypto';

const keyHex = () => randomBytes(32).toString('hex');

describe('restore decryption — inverts jobs/backup.ts', () => {
  it('round-trips the full pipeline: gzip -> encrypt -> decrypt -> gunzip', () => {
    const key = keyHex();
    const sql = Buffer.from(
      'CREATE TABLE candidates (id SERIAL PRIMARY KEY);\nINSERT INTO candidates VALUES (1);',
    );

    // backup.ts gzips (via a spawned `gzip`) and then encrypts; restore.ts
    // decrypts and then gunzips. Same order, both directions.
    const blob = encryptBackup(gzipSync(sql), key);
    const recovered = gunzipSync(decryptBackup(blob, key));

    expect(recovered.equals(sql)).toBe(true);
  });

  it('accepts the 64-hex-char key shape env.ts enforces', () => {
    const key = keyHex();
    expect(key).toMatch(/^[0-9a-f]{64}$/);

    const sql = Buffer.from('-- pg_dump output\nSELECT 1;');
    expect(gunzipSync(decryptBackup(encryptBackup(gzipSync(sql), key), key)).toString()).toBe(
      sql.toString(),
    );
  });

  it('rejects a malformed key instead of failing later with "Invalid key length"', () => {
    const blob = encryptBackup(gzipSync(Buffer.from('x')), keyHex());

    expect(() => decryptBackup(blob, 'oops')).toThrow(/64 hex characters/);
    expect(() => encryptBackup(Buffer.from('x'), 'oops')).toThrow(/64 hex characters/);
  });

  it('throws on a truncated buffer (too short for IV + AuthTag)', () => {
    expect(() => decryptBackup(randomBytes(20), keyHex())).toThrow(/too short/);
  });

  it('throws on a tampered auth tag', () => {
    const key = keyHex();
    const blob = encryptBackup(gzipSync(Buffer.from('sensitive candidate data')), key);

    const tampered = Buffer.from(blob);
    tampered.writeUInt8(tampered.readUInt8(15) ^ 0xff, 15);

    expect(() => decryptBackup(tampered, key)).toThrow();
  });

});
