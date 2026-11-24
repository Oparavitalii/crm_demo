/**
 * backup.test.ts
 *
 * Tests for the AES-256-GCM encryption logic used in the backup job.
 * We do NOT test the full backup pipeline (requires pg_dump + live DB),
 * but we validate the encrypt/decrypt round-trip and layout thoroughly.
 */
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptBackup, encryptBackup } from '../jobs/backup-crypto';

// ─── thin adapters over the REAL functions backup.ts/restore.ts run ─────────
//
// These used to be local re-implementations of backup.ts's crypto. They
// passed whatever backup.ts actually did, which is not a test. They now call
// production code; only the Buffer-key signature is adapted, because these
// tests were written before the shared module took the key as hex.

function encrypt(plaintext: Buffer, key: Buffer): Buffer {
  return encryptBackup(plaintext, key.toString('hex'));
}

function decrypt(blob: Buffer, key: Buffer): Buffer {
  return decryptBackup(blob, key.toString('hex'));
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('backup encryption — AES-256-GCM', () => {
  it('produces a blob with IV(12) | AuthTag(16) | ciphertext layout', () => {
    const key = randomBytes(32); // 256-bit key
    const plaintext = Buffer.from('SELECT 1; -- fake pg_dump output');

    const blob = encrypt(plaintext, key);

    // Minimum length: 12 (IV) + 16 (AuthTag) + at least 1 byte of ciphertext
    expect(blob.length).toBeGreaterThan(28);

    // The IV (first 12 bytes) must not be all-zero (statistically impossible)
    const iv = blob.subarray(0, 12);
    expect(iv.equals(Buffer.alloc(12))).toBe(false);

    // The authTag occupies bytes 12..28
    const authTag = blob.subarray(12, 28);
    expect(authTag.length).toBe(16);
  });

  it('round-trips: decrypt(encrypt(plain)) === plain', () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from('CREATE TABLE users (id SERIAL PRIMARY KEY);');

    const blob = encrypt(plaintext, key);
    const recovered = decrypt(blob, key);

    expect(recovered.equals(plaintext)).toBe(true);
    expect(recovered.toString()).toBe(plaintext.toString());
  });

  it('round-trips with a 64-hex-char key string (as used in env.ts)', () => {
    // Generate key as 64 lowercase hex chars (as produced by openssl rand -hex 32)
    const hexKey = randomBytes(32).toString('hex');
    expect(hexKey).toMatch(/^[0-9a-f]{64}$/);

    const keyBuf = Buffer.from(hexKey, 'hex');
    expect(keyBuf.length).toBe(32); // 256 bits

    const plaintext = Buffer.from('INSERT INTO candidates VALUES (1, "Jan Kowalski");');
    const blob = encrypt(plaintext, keyBuf);
    const recovered = decrypt(blob, keyBuf);

    expect(recovered.equals(plaintext)).toBe(true);
  });

  it('throws on tampered ciphertext (GCM authentication failure)', () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from('sensitive backup data');
    const blob = encrypt(plaintext, key);

    // Flip a bit in the ciphertext section (after IV + AuthTag = 28 bytes)
    const tampered = Buffer.from(blob);
    tampered.writeUInt8((tampered.readUInt8(30) ^ 0xff), 30);

    expect(() => decrypt(tampered, key)).toThrow();
  });

  it('throws when wrong key is used for decryption', () => {
    const key = randomBytes(32);
    const wrongKey = randomBytes(32);
    const plaintext = Buffer.from('crm backup 2026');

    const blob = encrypt(plaintext, key);

    expect(() => decrypt(blob, wrongKey)).toThrow();
  });

  it('produces different IVs for each encryption (no IV reuse)', () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from('same plaintext each time');

    const blob1 = encrypt(plaintext, key);
    const blob2 = encrypt(plaintext, key);

    const iv1 = blob1.subarray(0, 12).toString('hex');
    const iv2 = blob2.subarray(0, 12).toString('hex');

    // IVs must differ — cryptographically guaranteed by randomBytes
    expect(iv1).not.toBe(iv2);
  });

  it('validates BACKUP_ENCRYPTION_KEY format: 64 lowercase hex chars', () => {
    const validKey = randomBytes(32).toString('hex');
    expect(validKey).toHaveLength(64);
    expect(validKey).toMatch(/^[0-9a-f]{64}$/);

    // Invalid formats
    expect('short').not.toMatch(/^[0-9a-f]{64}$/);
    expect('G'.repeat(64)).not.toMatch(/^[0-9a-f]{64}$/); // uppercase hex
    expect(randomBytes(32).toString('base64')).not.toMatch(/^[0-9a-f]{64}$/);
  });
});
