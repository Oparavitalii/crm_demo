import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

vi.mock('../repositories/status-lookups.repo', () => ({
  listActive: vi.fn(),
  listAll: vi.fn(),
  listDeleted: vi.fn(),
  findById: vi.fn(),
  findActiveByTypeAndCode: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
  restore: vi.fn(),
  hardDelete: vi.fn(),
  getUsageCount: vi.fn(),
  listAllActiveGrouped: vi.fn(),
}));
vi.mock('../services/audit.service', () => ({ log: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as repo from '../repositories/status-lookups.repo';
import * as audit from '../services/audit.service';

const admin = { id: 'admin-1', role: 'admin' as const };
const ctx = { ip: null, userAgent: null };

const baseRow = {
  id: 'sl-1',
  type: 'sources' as const,
  code: 'olx',
  labelPl: 'OLX',
  labelUa: 'OLX',
  groupKey: null,
  sortOrder: 100,
  isSystem: false,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdById: 'admin-1',
};

beforeEach(() => vi.clearAllMocks());

describe('status-lookups.service.create', () => {
  it('inserts and writes audit log', async () => {
    vi.mocked(repo.findActiveByTypeAndCode).mockResolvedValue(undefined);
    vi.mocked(repo.insert).mockResolvedValue(baseRow);

    const { create } = await import('../services/status-lookups.service');
    const row = await create(
      { type: 'sources', code: 'olx', labelPl: 'OLX', labelUa: 'OLX', sortOrder: 100 },
      admin,
      ctx,
    );

    expect(row.code).toBe('olx');
    expect(vi.mocked(repo.insert)).toHaveBeenCalledOnce();
    expect(vi.mocked(audit.log)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create_status_lookup', entityId: 'sl-1' }),
    );
  });

  it('throws DUPLICATE when active (type,code) already exists', async () => {
    vi.mocked(repo.findActiveByTypeAndCode).mockResolvedValue(baseRow);
    const { create } = await import('../services/status-lookups.service');
    await expect(
      create(
        { type: 'sources', code: 'olx', labelPl: 'OLX', labelUa: 'OLX', sortOrder: 0 },
        admin,
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE', status: 409 });
    expect(vi.mocked(repo.insert)).not.toHaveBeenCalled();
  });
});

describe('status-lookups.service.softDelete', () => {
  it('writes audit BEFORE calling repo.softDelete', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseRow);
    vi.mocked(repo.getUsageCount).mockResolvedValue(0);
    vi.mocked(repo.softDelete).mockResolvedValue({ ...baseRow, deletedAt: new Date() });

    const order: string[] = [];
    vi.mocked(audit.log).mockImplementation(async () => {
      order.push('audit');
    });
    vi.mocked(repo.softDelete).mockImplementation(async () => {
      order.push('delete');
      return { ...baseRow, deletedAt: new Date() };
    });

    const { softDelete } = await import('../services/status-lookups.service');
    const result = await softDelete('sl-1', admin, ctx);

    expect(result.usageCount).toBe(0);
    expect(order).toEqual(['audit', 'delete']);
  });

  it('blocks soft-delete when isSystem=true', async () => {
    vi.mocked(repo.findById).mockResolvedValue({ ...baseRow, isSystem: true });
    const { softDelete } = await import('../services/status-lookups.service');
    await expect(softDelete('sl-1', admin, ctx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 409,
    });
    expect(vi.mocked(repo.softDelete)).not.toHaveBeenCalled();
  });

  // 2026-06-12: soft-delete no longer blocks on usageCount — admin can retire
  // a lookup row even while live candidates still reference it. The orphaned
  // refs render as "Unknown" on the dashboard / lists. The usageCount returned
  // from the call lets the UI flash "N rows now show as Unknown".
  it('proceeds with soft-delete even when usageCount > 0 and returns the count', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseRow);
    vi.mocked(repo.getUsageCount).mockResolvedValue(5);
    vi.mocked(repo.softDelete).mockResolvedValue({ ...baseRow, deletedAt: new Date() });
    const { softDelete } = await import('../services/status-lookups.service');
    const result = await softDelete('sl-1', admin, ctx);
    expect(result.usageCount).toBe(5);
    expect(vi.mocked(repo.softDelete)).toHaveBeenCalledWith('sl-1');
  });
});

describe('status-lookups.service.restore', () => {
  it('rejects when an active row with the same code already exists', async () => {
    vi.mocked(repo.findById).mockResolvedValue({ ...baseRow, deletedAt: new Date() });
    vi.mocked(repo.findActiveByTypeAndCode).mockResolvedValue(baseRow);

    const { restore } = await import('../services/status-lookups.service');
    await expect(restore('sl-1', admin, ctx)).rejects.toMatchObject({
      code: 'DUPLICATE',
      status: 409,
    });
    expect(vi.mocked(repo.restore)).not.toHaveBeenCalled();
  });
});

describe('status-lookups.service.update', () => {
  it('updates labelPl/labelUa/sortOrder and writes audit with old + new values', async () => {
    const updated = {
      ...baseRow,
      labelPl: 'OLX Praca',
      labelUa: 'OLX Робота',
      sortOrder: 50,
    };
    vi.mocked(repo.findById).mockResolvedValue(baseRow);
    vi.mocked(repo.update).mockResolvedValue(updated);

    const { update } = await import('../services/status-lookups.service');
    const row = await update(
      'sl-1',
      { labelPl: 'OLX Praca', labelUa: 'OLX Робота', sortOrder: 50 },
      admin,
      ctx,
    );

    expect(row.labelPl).toBe('OLX Praca');
    expect(vi.mocked(repo.update)).toHaveBeenCalledWith('sl-1', {
      labelPl: 'OLX Praca',
      labelUa: 'OLX Робота',
      sortOrder: 50,
    });
    expect(vi.mocked(audit.log)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update_status_lookup',
        entityType: 'status_lookup',
        entityId: 'sl-1',
        oldValue: { labelPl: 'OLX', labelUa: 'OLX', sortOrder: 100 },
        newValue: { labelPl: 'OLX Praca', labelUa: 'OLX Робота', sortOrder: 50 },
      }),
    );
  });

  it('audit oldValue/newValue only include keys actually present in the patch', async () => {
    // Caller PATCHes labelPl only — audit must not leak unchanged labelUa/sortOrder
    // into the diff, otherwise the audit log becomes noisy and misleading.
    const updated = { ...baseRow, labelPl: 'OLX Nowy' };
    vi.mocked(repo.findById).mockResolvedValue(baseRow);
    vi.mocked(repo.update).mockResolvedValue(updated);

    const { update } = await import('../services/status-lookups.service');
    await update('sl-1', { labelPl: 'OLX Nowy' }, admin, ctx);

    expect(vi.mocked(audit.log)).toHaveBeenCalledWith(
      expect.objectContaining({
        oldValue: { labelPl: 'OLX' },
        newValue: { labelPl: 'OLX Nowy' },
      }),
    );
    const auditCall = vi.mocked(audit.log).mock.calls[0]?.[0];
    expect(Object.keys(auditCall?.oldValue ?? {})).toEqual(['labelPl']);
    expect(Object.keys(auditCall?.newValue ?? {})).toEqual(['labelPl']);
  });

  it('throws NotFoundError when id does not exist', async () => {
    vi.mocked(repo.findById).mockResolvedValue(undefined);
    const { update } = await import('../services/status-lookups.service');
    await expect(
      update('missing', { labelPl: 'X' }, admin, ctx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(vi.mocked(repo.update)).not.toHaveBeenCalled();
    expect(vi.mocked(audit.log)).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when repo.update returns undefined (row vanished between read & write)', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseRow);
    vi.mocked(repo.update).mockResolvedValue(undefined);
    const { update } = await import('../services/status-lookups.service');
    await expect(
      update('sl-1', { labelPl: 'X' }, admin, ctx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(vi.mocked(audit.log)).not.toHaveBeenCalled();
  });

  it('updateStatusLookupSchema is strict-omit: type and code are not in the schema', async () => {
    // Service does not re-validate (router does it via zValidator). Lock the
    // schema contract here so accidentally widening the schema later — exposing
    // type/code as editable — fails this test before reaching prod.
    const { updateStatusLookupSchema } = await import('@opushr/shared');
    const shape = (updateStatusLookupSchema as unknown as { shape: Record<string, unknown> })
      .shape;
    expect(Object.keys(shape).sort()).toEqual(['groupKey', 'labelPl', 'labelUa', 'sortOrder']);
    expect(shape).not.toHaveProperty('type');
    expect(shape).not.toHaveProperty('code');
  });

  it('Zod rejects empty labelPl and labelUa (min: 1 after trim)', async () => {
    const { updateStatusLookupSchema } = await import('@opushr/shared');
    expect(updateStatusLookupSchema.safeParse({ labelPl: '' }).success).toBe(false);
    expect(updateStatusLookupSchema.safeParse({ labelUa: '' }).success).toBe(false);
    expect(updateStatusLookupSchema.safeParse({ labelPl: '   ' }).success).toBe(false);
  });

  it('Zod rejects labelPl/labelUa longer than 100 characters', async () => {
    const { updateStatusLookupSchema } = await import('@opushr/shared');
    const tooLong = 'x'.repeat(101);
    expect(updateStatusLookupSchema.safeParse({ labelPl: tooLong }).success).toBe(false);
    expect(updateStatusLookupSchema.safeParse({ labelUa: tooLong }).success).toBe(false);
    expect(updateStatusLookupSchema.safeParse({ labelPl: 'x'.repeat(100) }).success).toBe(
      true,
    );
  });

  it('Zod rejects sortOrder out of range (< 0 or > 10_000)', async () => {
    const { updateStatusLookupSchema } = await import('@opushr/shared');
    expect(updateStatusLookupSchema.safeParse({ sortOrder: -1 }).success).toBe(false);
    expect(updateStatusLookupSchema.safeParse({ sortOrder: 10_001 }).success).toBe(false);
    expect(updateStatusLookupSchema.safeParse({ sortOrder: 0 }).success).toBe(true);
    expect(updateStatusLookupSchema.safeParse({ sortOrder: 10_000 }).success).toBe(true);
  });

  it('contract: updating a soft-deleted (in trash) lookup currently SUCCEEDS', async () => {
    // 2026-06-17: service does NOT check `existing.deletedAt` on update. Admin
    // can edit a trashed lookup's labels without restoring it first. Locking
    // this behavior so a future "fix" is a conscious decision, not silent. If
    // we ever want to block this, add `if (existing.deletedAt) throw …` in
    // services/status-lookups.service.ts:update and flip this test.
    const trashed = { ...baseRow, deletedAt: new Date() };
    const updated = { ...trashed, labelPl: 'OLX edytowany w koszu' };
    vi.mocked(repo.findById).mockResolvedValue(trashed);
    vi.mocked(repo.update).mockResolvedValue(updated);

    const { update } = await import('../services/status-lookups.service');
    const row = await update(
      'sl-1',
      { labelPl: 'OLX edytowany w koszu' },
      admin,
      ctx,
    );
    expect(row.labelPl).toBe('OLX edytowany w koszu');
    expect(vi.mocked(repo.update)).toHaveBeenCalledOnce();
    expect(vi.mocked(audit.log)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update_status_lookup' }),
    );
  });
});

describe('status-lookups.service.hardDelete', () => {
  it('blocks hard-delete when isSystem=true', async () => {
    vi.mocked(repo.findById).mockResolvedValue({ ...baseRow, isSystem: true });

    const { hardDelete } = await import('../services/status-lookups.service');
    await expect(hardDelete('sl-1', admin, ctx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 409,
    });
    expect(vi.mocked(repo.hardDelete)).not.toHaveBeenCalled();
  });

  it('blocks hard-delete when usageCount > 0', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseRow);
    vi.mocked(repo.getUsageCount).mockResolvedValue(5);

    const { hardDelete } = await import('../services/status-lookups.service');
    await expect(hardDelete('sl-1', admin, ctx)).rejects.toMatchObject({
      code: 'HAS_REFERENCES',
      status: 409,
    });
    expect(vi.mocked(repo.hardDelete)).not.toHaveBeenCalled();
  });

  it('audits BEFORE deleting and calls repo.hardDelete', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseRow);
    vi.mocked(repo.getUsageCount).mockResolvedValue(0);

    const order: string[] = [];
    vi.mocked(audit.log).mockImplementation(async () => {
      order.push('audit');
    });
    vi.mocked(repo.hardDelete).mockImplementation(async () => {
      order.push('delete');
      return true;
    });

    const { hardDelete } = await import('../services/status-lookups.service');
    await hardDelete('sl-1', admin, ctx);

    expect(order).toEqual(['audit', 'delete']);
  });
});

// One page open used to fire nine separate GET /status-lookups?type= requests
// (CandidateList mounts nine hooks, CandidateDetailPage nine more). Each cost a
// requireAuth session lookup plus its own pg connection, against a pool of 25.
describe('listAllActive', () => {
  const row = (type: string, code: string) => ({ type, code, labelPl: code, labelUa: code });

  beforeEach(async () => {
    vi.mocked(repo.listAllActiveGrouped).mockReset();
    const svc = await import('../services/status-lookups.service');
    svc.__resetLookupCache();
  });

  it('groups flat rows by type', async () => {
    vi.mocked(repo.listAllActiveGrouped).mockResolvedValue([
      row('sources', 'facebook'),
      row('sources', 'olx'),
      row('position', 'welder'),
    ] as never);
    const { listAllActive } = await import('../services/status-lookups.service');
    const grouped = await listAllActive();
    expect(Object.keys(grouped).sort()).toEqual(['position', 'sources']);
    expect(grouped.sources).toHaveLength(2);
    expect(grouped.position).toHaveLength(1);
  });

  it('hits the database once for concurrent callers', async () => {
    vi.mocked(repo.listAllActiveGrouped).mockResolvedValue([row('sources', 'facebook')] as never);
    const { listAllActive } = await import('../services/status-lookups.service');
    await Promise.all([listAllActive(), listAllActive(), listAllActive()]);
    expect(repo.listAllActiveGrouped).toHaveBeenCalledTimes(1);
  });

  it('serves a second call from cache', async () => {
    vi.mocked(repo.listAllActiveGrouped).mockResolvedValue([row('sources', 'facebook')] as never);
    const { listAllActive } = await import('../services/status-lookups.service');
    await listAllActive();
    await listAllActive();
    expect(repo.listAllActiveGrouped).toHaveBeenCalledTimes(1);
  });

  it('re-reads after an admin write busts the cache', async () => {
    vi.mocked(repo.listAllActiveGrouped).mockResolvedValue([row('sources', 'facebook')] as never);
    const svc = await import('../services/status-lookups.service');
    await svc.listAllActive();
    svc.bustLookupCache();
    await svc.listAllActive();
    expect(repo.listAllActiveGrouped).toHaveBeenCalledTimes(2);
  });
});
