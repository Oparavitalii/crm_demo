// The wire format of an encrypted backup, defined exactly once:
//
//   IV (12 bytes) | AuthTag (16 bytes) | Ciphertext (rest)
//
// AES-256-GCM. The plaintext handed in is already gzipped — compression is the
// backup pipeline's business, not the cipher's, and the two sides use
// different mechanisms for it (backup.ts spawns `gzip`, restore.ts uses
// zlib.gunzipSync).
//
// Why this file exists: until 2026-07-30 those offsets were spelled out in
// four places — backup.ts, restore.ts, and both test files, which mirrored the
// implementation instead of importing it. Every test passed against a copy, so
// a changed offset on either side would have gone unnoticed until someone
// actually needed a restore, which is the one moment you find out. backup.ts
// and restore.ts now provably invert each other because they share this
// module, and the tests exercise these functions rather than a lookalike.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const HEADER_BYTES = IV_BYTES + AUTH_TAG_BYTES;

// 32 bytes as 64 hex chars — the same shape env.ts enforces on
// BACKUP_ENCRYPTION_KEY. Re-checked here because restore.ts gets run by hand
// from arbitrary shells: `Buffer.from('oops', 'hex')` silently yields a 2-byte
// key, and the failure then surfaces from inside createCipheriv as an opaque
// "Invalid key length" at 3am.
function toKey(keyHex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error(
      'BACKUP_ENCRYPTION_KEY must be 64 hex characters (32 bytes for AES-256)',
    );
  }
  return Buffer.from(keyHex, 'hex');
}

export function encryptBackup(plaintext: Buffer, keyHex: string): Buffer {
  // Random IV per backup — never reused with the same key.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', toKey(keyHex), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBackup(body: Buffer, keyHex: string): Buffer {
  if (body.length <= HEADER_BYTES) {
    throw new Error(
      `backup object is too short to contain IV + AuthTag (${body.length} bytes)`,
    );
  }

  const iv = body.subarray(0, IV_BYTES);
  const authTag = body.subarray(IV_BYTES, HEADER_BYTES);
  const ciphertext = body.subarray(HEADER_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', toKey(keyHex), iv);
  decipher.setAuthTag(authTag);
  // GCM verifies the tag inside final(), so a wrong key or a tampered blob
  // throws here rather than returning plausible-looking garbage.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
