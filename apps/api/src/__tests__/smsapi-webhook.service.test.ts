import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

const mockWhere = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn(() => ({ where: mockWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));

vi.mock('../db/client', () => ({
  db: {
    get update() {
      return mockUpdate;
    },
  },
}));
vi.mock('../services/audit.service', () => ({ log: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Dynamic import AFTER the process.env assignments above — a static import
// hoists past them, and the service pulls clients/smsapi.client → env.ts,
// which process.exit(1)s on missing vars when cwd has no .env (workspace runs).
const { isUuid, handleDeliveryReport } = await import(
  '../services/smsapi-webhook.service'
);

beforeEach(() => vi.clearAllMocks());

describe('isUuid', () => {
  it('accepts a canonical UUID', () => {
    expect(isUuid('00000000-0000-0000-0000-00000000feed')).toBe(true);
    expect(isUuid('6A466F8F-6536-3118-9400-7B478A9C11AB')).toBe(true);
  });

  it('rejects SMSAPI test placeholders and junk', () => {
    expect(isUuid('IDX')).toBe(false);
    expect(isUuid('444444444444444444444444')).toBe(false);
    expect(isUuid('')).toBe(false);
  });
});

describe('handleDeliveryReport — idx sanitation', () => {
  // Regression: SMSAPI's panel "Test" probe sends idx=IDX (literal). Feeding it
  // into eq(messages.id, ...) made Postgres throw on the uuid cast → 500 → the
  // panel retries for up to 14 days. A non-UUID idx must fall back to
  // external_id matching and resolve without throwing.
  it('does not throw on a non-UUID idx (SMSAPI test probe)', async () => {
    await expect(
      handleDeliveryReport({ msgId: '444444444444444444444444', status: '404', idx: 'IDX' }),
    ).resolves.toBeUndefined();
    expect(mockUpdate).toHaveBeenCalledOnce();
  });

  it('updates via idx when it is a valid UUID', async () => {
    await expect(
      handleDeliveryReport({
        msgId: 'EXT-1',
        status: 'DELIVERED',
        idx: '00000000-0000-0000-0000-00000000feed',
        doneDateUnix: 1751500000,
      }),
    ).resolves.toBeUndefined();
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'delivered', externalId: 'EXT-1' }),
    );
  });
});
