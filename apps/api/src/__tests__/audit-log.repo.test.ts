import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

// listByEntityIds / listAll page through db.query.auditLog.findMany in batches of
// 500. vi.hoisted keeps the mock reachable from the hoisted vi.mock factory.
const { mockFindMany } = vi.hoisted(() => ({ mockFindMany: vi.fn() }));
vi.mock('../db/client', () => ({
  db: { query: { auditLog: { findMany: mockFindMany } } },
}));

import * as auditLogRepo from '../repositories/audit-log.repo';

function makeEntry(id: string) {
  return {
    id,
    actorId: 'admin-1',
    action: 'create_candidate',
    entityType: 'candidate',
    entityId: 'cand-1',
    oldValue: null,
    newValue: null,
    ip: null,
    userAgent: null,
    createdAt: new Date('2024-01-01'),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('audit-log.repo.listByEntityIds', () => {
  it('returns [] without querying when ids is empty', async () => {
    const result = await auditLogRepo.listByEntityIds([]);
    expect(result).toEqual([]);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('returns a single short batch without a second page', async () => {
    const batch = Array.from({ length: 3 }, (_, i) => makeEntry(`a-${i}`));
    mockFindMany.mockResolvedValueOnce(batch);

    const result = await auditLogRepo.listByEntityIds(['cand-1', 'cand-2']);

    expect(result).toHaveLength(3);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 500, offset: 0 }),
    );
  });

  it('pages through full batches until a short batch ends the loop', async () => {
    const fullBatch = Array.from({ length: 500 }, (_, i) => makeEntry(`p-${i}`));
    const tailBatch = Array.from({ length: 12 }, (_, i) => makeEntry(`t-${i}`));
    mockFindMany.mockResolvedValueOnce(fullBatch).mockResolvedValueOnce(tailBatch);

    const result = await auditLogRepo.listByEntityIds(['cand-1']);

    expect(result).toHaveLength(512);
    expect(mockFindMany).toHaveBeenCalledTimes(2);
    expect(mockFindMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 0 }));
    expect(mockFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 500 }));
  });
});
