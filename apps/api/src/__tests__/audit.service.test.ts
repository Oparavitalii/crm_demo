import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

vi.mock('../repositories/audit-log.repo', () => ({
  insert: vi.fn(),
}));

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as repo from '../repositories/audit-log.repo';
import * as audit from '../services/audit.service';

beforeEach(() => vi.clearAllMocks());

describe('audit.service.log — single chokepoint for every mutation in the system', () => {
  it('forwards all fields verbatim to repo.insert', async () => {
    await audit.log({
      actorId: 'user-1',
      action: 'create_candidate',
      entityType: 'candidate',
      entityId: 'cand-1',
      oldValue: null,
      newValue: { name: 'Anna' },
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    });

    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(repo.insert).toHaveBeenCalledWith({
      actorId: 'user-1',
      action: 'create_candidate',
      entityType: 'candidate',
      entityId: 'cand-1',
      oldValue: null,
      newValue: { name: 'Anna' },
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    });
  });

  it('defaults all optional fields to null when omitted', async () => {
    await audit.log({
      action: 'system_event',
      entityType: 'system',
    });

    expect(repo.insert).toHaveBeenCalledWith({
      actorId: null,
      action: 'system_event',
      entityType: 'system',
      entityId: null,
      oldValue: null,
      newValue: null,
      ip: null,
      userAgent: null,
    });
  });

  it('accepts actorId=null for system/cron actors (retention sweep pattern)', async () => {
    await audit.log({
      actorId: null,
      action: 'retention_sweep',
      entityType: 'system',
      entityId: null,
      newValue: { candidatesAnonymized: 5 },
      ip: null,
      userAgent: 'cron/retention',
    });

    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: null, userAgent: 'cron/retention' }),
    );
  });

  it('preserves complex nested oldValue / newValue shapes (no flattening, no mutation)', async () => {
    const oldValue = {
      hadEmail: true,
      hadPhone: false,
      tags: ['imported', 'fb-poll'],
      nested: { source: 'facebook', score: 0.87 },
    };
    const newValue = { anonymizedAt: '2026-06-15T10:00:00.000Z' };

    await audit.log({
      actorId: 'admin-1',
      action: 'anonymize_candidate',
      entityType: 'candidate',
      entityId: 'cand-9',
      oldValue,
      newValue,
      ip: '198.51.100.1',
      userAgent: 'curl/8.0',
    });

    const passed = vi.mocked(repo.insert).mock.calls[0]?.[0];
    expect(passed?.oldValue).toEqual(oldValue);
    expect(passed?.newValue).toEqual(newValue);
    // Caller's object must not be mutated by the service.
    expect(oldValue.nested.score).toBe(0.87);
  });

  it('accepts primitive and array values for oldValue / newValue (JSONB column is loose)', async () => {
    await audit.log({
      action: 'update_field',
      entityType: 'candidate',
      entityId: 'cand-1',
      oldValue: 'old-status',
      newValue: ['new-status', 'fallback-status'],
    });

    const passed = vi.mocked(repo.insert).mock.calls[0]?.[0];
    expect(passed?.oldValue).toBe('old-status');
    expect(passed?.newValue).toEqual(['new-status', 'fallback-status']);
  });

  it('propagates repo errors — no swallowing (caller must decide rollback)', async () => {
    const dbError = new Error('connection terminated');
    vi.mocked(repo.insert).mockRejectedValueOnce(dbError);

    await expect(
      audit.log({
        action: 'delete_candidate',
        entityType: 'candidate',
        entityId: 'cand-1',
      }),
    ).rejects.toThrow('connection terminated');
  });

  it('does NOT redact PII — that is the caller responsibility (see anonymize.service pattern)', async () => {
    // Intentional contract test: the audit service is a dumb pass-through.
    // Redaction is enforced upstream by callers (boolean flags in anonymize,
    // consent withdrawal, dismissals). If a future change adds redaction here,
    // it will likely double-redact or break PII-by-design audits.
    const piiPayload = { email: 'leaked@example.com', phone: '+48123456789' };
    await audit.log({
      action: 'test_passthrough',
      entityType: 'candidate',
      entityId: 'cand-1',
      newValue: piiPayload,
    });

    const passed = vi.mocked(repo.insert).mock.calls[0]?.[0];
    expect(passed?.newValue).toEqual(piiPayload);
  });

  it('preserves empty-string action / entityType (validation is the caller layer, not here)', async () => {
    await audit.log({
      action: '',
      entityType: '',
    });

    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: '', entityType: '' }),
    );
  });

  it('returns void (no audit row id leaked to caller — keeps trail append-only)', async () => {
    vi.mocked(repo.insert).mockResolvedValue(undefined);
    const result = await audit.log({
      action: 'noop',
      entityType: 'system',
    });
    expect(result).toBeUndefined();
  });

  it('inserts once per call — no batching, no debouncing', async () => {
    await audit.log({ action: 'a', entityType: 't' });
    await audit.log({ action: 'b', entityType: 't' });
    await audit.log({ action: 'c', entityType: 't' });
    expect(repo.insert).toHaveBeenCalledTimes(3);
  });
});
