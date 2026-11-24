import { describe, expect, it } from 'vitest';
import { updateCandidateSchema } from '@opushr/shared';

// 2026-07-10 — the Excel import exported numeric phone columns as floats
// ("380936645458.0"), which made every full-form save fail with HTTP 400
// (client video 09.07). phoneSchema now strips the trailing ".0" during
// preprocess instead of rejecting; everything else stays strict.
describe('phoneSchema normalization (via updateCandidateSchema)', () => {
  it('strips the Excel float artifact ".0"', () => {
    const res = updateCandidateSchema.safeParse({ phone: '380936645458.0' });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.phone).toBe('380936645458');
  });

  it('accepts a normal international phone unchanged', () => {
    const res = updateCandidateSchema.safeParse({ phone: '+48 500 600 700' });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.phone).toBe('+48 500 600 700');
  });

  it('still rejects letters and too-short values', () => {
    expect(updateCandidateSchema.safeParse({ phone: 'вышел' }).success).toBe(false);
    expect(updateCandidateSchema.safeParse({ phone: '123' }).success).toBe(false);
  });

  it('null and omitted phone still pass (nullish)', () => {
    expect(updateCandidateSchema.safeParse({ phone: null }).success).toBe(true);
    expect(updateCandidateSchema.safeParse({}).success).toBe(true);
  });
});
