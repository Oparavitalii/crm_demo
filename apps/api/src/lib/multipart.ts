// Minimal multipart/form-data parser using the built-in Web FormData API
// (available in Hono via c.req.parseBody). This helper centralizes the
// validation pattern for single-file uploads.
import type { Context } from 'hono';
import { AppError } from './errors';

export interface ParsedFileUpload<TMeta> {
  meta: TMeta;
  file: { body: Buffer; mime: string; sizeBytes: number; filename: string };
}

// Pulls a single file field + JSON metadata from a multipart body.
// `metaField` = name of the form field holding JSON-encoded metadata.
// `fileField` = name of the form field holding the binary blob.
//
// If `expectedMime` is given, the function also runs a magic-byte sniff and
// rejects when the actual file content disagrees with the claimed MIME. The
// `Content-Type` header alone is attacker-controlled — without this check a
// crafted .exe could pose as `application/pdf`.
export async function parseFileUpload<TMeta>(
  c: Context,
  fileField: string,
  metaField: string,
  expectedMime?: string,
): Promise<ParsedFileUpload<TMeta>> {
  const body = await c.req.parseBody();
  const fileVal = body[fileField];
  const metaVal = body[metaField];

  if (typeof metaVal !== 'string') {
    throw new AppError('VALIDATION', { reason: `missing ${metaField}` }, 400);
  }
  if (!(fileVal instanceof File)) {
    throw new AppError('VALIDATION', { reason: `missing ${fileField}` }, 400);
  }

  let meta: TMeta;
  try {
    meta = JSON.parse(metaVal) as TMeta;
  } catch {
    throw new AppError('VALIDATION', { reason: 'invalid_meta_json' }, 400);
  }

  const buf = Buffer.from(await fileVal.arrayBuffer());

  if (expectedMime !== undefined) {
    const detected = detectMime(buf);
    if (detected !== expectedMime || fileVal.type !== expectedMime) {
      throw new AppError(
        'VALIDATION',
        { reason: 'mime_mismatch', claimed: fileVal.type, detected, expected: expectedMime },
        415,
      );
    }
  }

  return {
    meta,
    file: {
      body: buf,
      mime: fileVal.type,
      sizeBytes: buf.byteLength,
      filename: fileVal.name,
    },
  };
}

// Sniffs the first few bytes of a buffer to identify the actual file format.
// Returns null when the content matches no known type — caller treats null
// as "reject" rather than "trust the Content-Type header".
//
// Signature table is kept short on purpose: we accept exactly the types the
// CRM persists (PDF for documents, JPEG/PNG/WEBP for photos).
export function detectMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;

  // PDF: literal "%PDF-" at offset 0.
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d) {
    return 'application/pdf';
  }

  // JPEG: FF D8 FF (any third-byte marker — E0/E1/DB/EE).
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A.
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WEBP: "RIFF" at 0 + "WEBP" at 8.
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}
