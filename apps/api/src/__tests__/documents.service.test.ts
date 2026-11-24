import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

vi.mock('../repositories/documents.repo', () => ({
  list: vi.fn(),
  findById: vi.fn(),
  findBySlug: vi.fn(),
  findBySlugIncludingDeleted: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
}));
vi.mock('../repositories/document-acceptances.repo', () => ({
  insert: vi.fn(),
  findByDocVersionUser: vi.fn(),
  listPendingForUser: vi.fn(),
  listForDocument: vi.fn(),
  listForUser: vi.fn(),
}));
vi.mock('../services/audit.service', () => ({ log: vi.fn() }));
vi.mock('../clients/r2.client', () => ({
  putObject: vi.fn(),
  presignGet: vi.fn(),
  deleteObject: vi.fn(),
  extractObjectKey: vi.fn(),
}));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as repo from '../repositories/documents.repo';
import * as accRepo from '../repositories/document-acceptances.repo';
import * as audit from '../services/audit.service';
import * as r2 from '../clients/r2.client';
import { AppError, ForbiddenError, NotFoundError } from '../lib/errors';

const adminUser = { id: 'admin-1', role: 'admin' as const };
const recruiterUser = { id: 'rec-1', role: 'recruiter' as const };
const ctx = { ip: '1.2.3.4', userAgent: 'jest' };

const baseDoc = {
  id: 'doc-1',
  slug: 'regulamin-crm',
  title: 'Regulamin CRM',
  category: 'regulamin' as const,
  contentMd: '# Regulamin',
  fileKey: null,
  fileMime: null,
  fileSizeBytes: null,
  version: 1,
  requiresAcceptance: true,
  visibleToRoles: ['admin', 'recruiter', 'coordinator', 'readonly'] as const,
  publishedAt: new Date(),
  createdBy: 'admin-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

beforeEach(() => vi.clearAllMocks());

describe('documents.service.createMarkdownDocument', () => {
  it('inserts a new MD document and audits', async () => {
    vi.mocked(repo.findBySlugIncludingDeleted).mockResolvedValue(undefined);
    vi.mocked(repo.insert).mockResolvedValue({ ...baseDoc, publishedAt: null });
    const { createMarkdownDocument } = await import('../services/documents.service');
    const result = await createMarkdownDocument(
      {
        slug: 'regulamin-crm',
        title: 'Regulamin CRM',
        category: 'regulamin',
        contentMd: '# Regulamin',
        requiresAcceptance: true,
        visibleToRoles: ['admin', 'recruiter', 'coordinator', 'readonly'],
      },
      adminUser,
      ctx,
    );
    expect(result.id).toBe('doc-1');
    expect(repo.insert).toHaveBeenCalledOnce();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create_document',
        entityType: 'document',
        entityId: 'doc-1',
      }),
    );
  });

  it('rejects when slug already exists (including soft-deleted)', async () => {
    vi.mocked(repo.findBySlugIncludingDeleted).mockResolvedValue(baseDoc);
    const { createMarkdownDocument } = await import('../services/documents.service');
    await expect(
      createMarkdownDocument(
        {
          slug: 'regulamin-crm',
          title: 'Regulamin CRM',
          category: 'regulamin',
          contentMd: '# x',
          requiresAcceptance: false,
          visibleToRoles: ['admin'],
        },
        adminUser,
        ctx,
      ),
    ).rejects.toThrow(AppError);
    expect(repo.insert).not.toHaveBeenCalled();
  });
});

describe('documents.service.updateDocument', () => {
  it('bumps version when published doc with requiresAcceptance=true is edited', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseDoc);
    vi.mocked(repo.update).mockImplementation(async (_id, patch) => ({
      ...baseDoc,
      ...patch,
    }));
    const { updateDocument } = await import('../services/documents.service');
    const result = await updateDocument(
      'doc-1',
      { contentMd: '# v2' },
      adminUser,
      ctx,
    );
    expect(result.version).toBe(2);
    expect(repo.update).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({ version: 2 }),
    );
  });

  it('does NOT bump version on draft (publishedAt null)', async () => {
    vi.mocked(repo.findById).mockResolvedValue({ ...baseDoc, publishedAt: null });
    vi.mocked(repo.update).mockImplementation(async (_id, patch) => ({
      ...baseDoc,
      publishedAt: null,
      ...patch,
    }));
    const { updateDocument } = await import('../services/documents.service');
    await updateDocument('doc-1', { title: 'X' }, adminUser, ctx);
    const passed = vi.mocked(repo.update).mock.calls[0]?.[1] as { version?: number };
    expect(passed.version).toBeUndefined();
  });

  it('does NOT bump version when title + contentMd are unchanged (no-op edit)', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseDoc);
    vi.mocked(repo.update).mockImplementation(async (_id, patch) => ({
      ...baseDoc,
      ...patch,
    }));
    const { updateDocument } = await import('../services/documents.service');
    // Submit same title + same contentMd — admin "saved" without changes.
    await updateDocument(
      'doc-1',
      { title: baseDoc.title, contentMd: baseDoc.contentMd ?? '' },
      adminUser,
      ctx,
    );
    const passed = vi.mocked(repo.update).mock.calls[0]?.[1] as { version?: number };
    expect(passed.version).toBeUndefined();
  });

  it('does NOT bump version when requiresAcceptance=false', async () => {
    vi.mocked(repo.findById).mockResolvedValue({ ...baseDoc, requiresAcceptance: false });
    vi.mocked(repo.update).mockImplementation(async (_id, patch) => ({
      ...baseDoc,
      requiresAcceptance: false,
      ...patch,
    }));
    const { updateDocument } = await import('../services/documents.service');
    await updateDocument('doc-1', { title: 'X' }, adminUser, ctx);
    const passed = vi.mocked(repo.update).mock.calls[0]?.[1] as { version?: number };
    expect(passed.version).toBeUndefined();
  });
});

describe('documents.service.softDeleteDocument', () => {
  it('audits BEFORE soft delete', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseDoc);
    vi.mocked(repo.softDelete).mockResolvedValue(true);
    const auditOrder: string[] = [];
    vi.mocked(audit.log).mockImplementation(async () => {
      auditOrder.push('audit');
    });
    vi.mocked(repo.softDelete).mockImplementation(async () => {
      auditOrder.push('delete');
      return true;
    });
    const { softDeleteDocument } = await import('../services/documents.service');
    await softDeleteDocument('doc-1', adminUser, ctx);
    expect(auditOrder).toEqual(['audit', 'delete']);
  });

  it('throws NotFound when doc missing', async () => {
    vi.mocked(repo.findById).mockResolvedValue(undefined);
    const { softDeleteDocument } = await import('../services/documents.service');
    await expect(softDeleteDocument('doc-x', adminUser, ctx)).rejects.toThrow(NotFoundError);
  });
});

describe('documents.service.acceptDocument', () => {
  it('rejects when version mismatch (race condition)', async () => {
    vi.mocked(repo.findById).mockResolvedValue({ ...baseDoc, version: 3 });
    const { acceptDocument } = await import('../services/documents.service');
    await expect(
      acceptDocument({ documentId: 'doc-1', version: 2 }, recruiterUser, ctx),
    ).rejects.toThrow(AppError);
    expect(accRepo.insert).not.toHaveBeenCalled();
  });

  it('rejects when doc not published', async () => {
    vi.mocked(repo.findById).mockResolvedValue({ ...baseDoc, publishedAt: null });
    const { acceptDocument } = await import('../services/documents.service');
    await expect(
      acceptDocument({ documentId: 'doc-1', version: 1 }, recruiterUser, ctx),
    ).rejects.toThrow(AppError);
  });

  it('inserts acceptance and audits when version matches', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseDoc);
    vi.mocked(accRepo.findByDocVersionUser).mockResolvedValue(undefined);
    vi.mocked(accRepo.insert).mockResolvedValue({
      id: 'acc-1',
      documentId: 'doc-1',
      version: 1,
      userId: 'rec-1',
      acceptedAt: new Date(),
      ip: '1.2.3.4',
      userAgent: 'jest',
    });
    const { acceptDocument } = await import('../services/documents.service');
    const result = await acceptDocument(
      { documentId: 'doc-1', version: 1 },
      recruiterUser,
      ctx,
    );
    expect(result.id).toBe('acc-1');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'accept_document', entityId: 'doc-1' }),
    );
  });

  it('is idempotent — second accept of same version returns existing row', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseDoc);
    const existing = {
      id: 'acc-1',
      documentId: 'doc-1',
      version: 1,
      userId: 'rec-1',
      acceptedAt: new Date(),
      ip: '1.2.3.4',
      userAgent: 'jest',
    };
    vi.mocked(accRepo.findByDocVersionUser).mockResolvedValue(existing);
    const { acceptDocument } = await import('../services/documents.service');
    const result = await acceptDocument(
      { documentId: 'doc-1', version: 1 },
      recruiterUser,
      ctx,
    );
    expect(result.id).toBe('acc-1');
    expect(accRepo.insert).not.toHaveBeenCalled();
  });
});

describe('documents.service.listPendingAcceptancesForUser', () => {
  it('filters by visibleToRoles', async () => {
    vi.mocked(accRepo.listPendingForUser).mockResolvedValue([
      { ...baseDoc, visibleToRoles: ['admin'] },
      { ...baseDoc, id: 'doc-2', visibleToRoles: ['recruiter', 'admin'] },
    ]);
    const { listPendingAcceptancesForUser } = await import('../services/documents.service');
    const result = await listPendingAcceptancesForUser(recruiterUser);
    expect(result).toHaveLength(1);
    expect(result[0]?.document.id).toBe('doc-2');
  });
});

// --- New coverage: R2 upload / download flows -------------------------------
//
// The previous suite stopped at MD-only flows + acceptance/version logic and
// never touched createFileDocument or getDocumentFileUrl. Those paths own all
// of the R2 interaction (putObject, presignGet, deleteObject) plus the
// content-type and size guards. Without them the service sits at ~54% lines.

const fileMeta = {
  slug: 'rodo-policy',
  title: 'RODO Policy',
  category: 'rodo' as const,
  requiresAcceptance: true,
  visibleToRoles: ['admin', 'recruiter', 'coordinator', 'readonly'] as Array<
    'admin' | 'recruiter' | 'coordinator' | 'readonly'
  >,
};

const baseFileDoc = {
  ...baseDoc,
  id: 'doc-file-1',
  slug: 'rodo-policy',
  title: 'RODO Policy',
  category: 'rodo' as const,
  contentMd: null,
  fileKey: 'documents/pending/uuid',
  fileMime: 'application/pdf',
  fileSizeBytes: 1024,
  publishedAt: null,
};

describe('documents.service.createFileDocument — R2 upload happy path', () => {
  it('uploads PDF to R2 with final key + correct content-type, then finalizes DB row', async () => {
    vi.mocked(repo.findBySlugIncludingDeleted).mockResolvedValue(undefined);
    vi.mocked(repo.insert).mockResolvedValue(baseFileDoc);
    vi.mocked(repo.update).mockImplementation(async (_id, patch) => ({
      ...baseFileDoc,
      ...patch,
    }));
    vi.mocked(r2.putObject).mockResolvedValue(undefined);

    const { createFileDocument } = await import('../services/documents.service');
    const body = Buffer.from('%PDF-1.7 fake bytes');
    const result = await createFileDocument(
      fileMeta,
      { body, mime: 'application/pdf', sizeBytes: body.byteLength },
      adminUser,
      ctx,
    );

    // Final key is reconstructed from the returned row id + version.
    expect(r2.putObject).toHaveBeenCalledOnce();
    const putArg = vi.mocked(r2.putObject).mock.calls[0]?.[0];
    expect(putArg?.key).toBe(`documents/${baseFileDoc.id}/v${baseFileDoc.version}.pdf`);
    expect(putArg?.contentType).toBe('application/pdf');
    expect(putArg?.body).toBe(body);

    // After upload, repo.update is called to swap the placeholder tempKey for
    // the final key — the row callers see should never carry `documents/pending/...`.
    expect(repo.update).toHaveBeenCalledWith(
      baseFileDoc.id,
      expect.objectContaining({ fileKey: `documents/${baseFileDoc.id}/v${baseFileDoc.version}.pdf` }),
    );
    expect(result.fileKey).toBe(`documents/${baseFileDoc.id}/v${baseFileDoc.version}.pdf`);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create_document',
        entityType: 'document',
        entityId: baseFileDoc.id,
        newValue: expect.objectContaining({ kind: 'file', mime: 'application/pdf' }),
      }),
    );
  });
});

describe('documents.service.createFileDocument — content-type & size guards', () => {
  it('rejects non-PDF mime with 415 / VALIDATION (only_pdf_allowed)', async () => {
    const { createFileDocument } = await import('../services/documents.service');
    await expect(
      createFileDocument(
        fileMeta,
        { body: Buffer.from('GIF89a'), mime: 'image/gif', sizeBytes: 6 },
        adminUser,
        ctx,
      ),
    ).rejects.toMatchObject({
      status: 415,
      meta: expect.objectContaining({ reason: 'only_pdf_allowed' }),
    });
    // Hard guard: nothing should be inserted or uploaded.
    expect(repo.insert).not.toHaveBeenCalled();
    expect(r2.putObject).not.toHaveBeenCalled();
  });

  it('rejects oversized PDF (>10MB) with 413 / VALIDATION (file_too_large_10mb)', async () => {
    const { createFileDocument } = await import('../services/documents.service');
    await expect(
      createFileDocument(
        fileMeta,
        {
          body: Buffer.from(''),
          mime: 'application/pdf',
          sizeBytes: 10 * 1024 * 1024 + 1,
        },
        adminUser,
        ctx,
      ),
    ).rejects.toMatchObject({
      status: 413,
      meta: expect.objectContaining({ reason: 'file_too_large_10mb' }),
    });
    expect(repo.insert).not.toHaveBeenCalled();
    expect(r2.putObject).not.toHaveBeenCalled();
  });

  it('rejects duplicate slug BEFORE touching R2', async () => {
    vi.mocked(repo.findBySlugIncludingDeleted).mockResolvedValue(baseFileDoc);
    const { createFileDocument } = await import('../services/documents.service');
    await expect(
      createFileDocument(
        fileMeta,
        {
          body: Buffer.from('%PDF'),
          mime: 'application/pdf',
          sizeBytes: 4,
        },
        adminUser,
        ctx,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(r2.putObject).not.toHaveBeenCalled();
  });

  it('non-admin actor cannot create a file document', async () => {
    const { createFileDocument } = await import('../services/documents.service');
    await expect(
      createFileDocument(
        fileMeta,
        { body: Buffer.from('%PDF'), mime: 'application/pdf', sizeBytes: 4 },
        recruiterUser,
        ctx,
      ),
    ).rejects.toThrow(ForbiddenError);
    expect(r2.putObject).not.toHaveBeenCalled();
  });
});

describe('documents.service.createFileDocument — R2 failure cleanup', () => {
  it('rolls back: when R2 putObject throws, soft-deletes the row and best-effort deletes R2 object', async () => {
    vi.mocked(repo.findBySlugIncludingDeleted).mockResolvedValue(undefined);
    vi.mocked(repo.insert).mockResolvedValue(baseFileDoc);
    vi.mocked(r2.putObject).mockRejectedValue(new Error('r2 503 internal'));
    vi.mocked(r2.deleteObject).mockResolvedValue({ deleted: true });
    vi.mocked(repo.softDelete).mockResolvedValue(true);

    const { createFileDocument } = await import('../services/documents.service');
    await expect(
      createFileDocument(
        fileMeta,
        {
          body: Buffer.from('%PDF'),
          mime: 'application/pdf',
          sizeBytes: 4,
        },
        adminUser,
        ctx,
      ),
    ).rejects.toThrow();

    // Cleanup path: both compensating actions fire so we don't leak orphans.
    expect(r2.deleteObject).toHaveBeenCalledWith(
      `documents/${baseFileDoc.id}/v${baseFileDoc.version}.pdf`,
    );
    expect(repo.softDelete).toHaveBeenCalledWith(baseFileDoc.id);
    // Audit must NOT fire — we never reached the success path.
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rolls back when DB finalize (repo.update) returns undefined', async () => {
    vi.mocked(repo.findBySlugIncludingDeleted).mockResolvedValue(undefined);
    vi.mocked(repo.insert).mockResolvedValue(baseFileDoc);
    vi.mocked(r2.putObject).mockResolvedValue(undefined);
    vi.mocked(repo.update).mockResolvedValue(undefined);
    vi.mocked(r2.deleteObject).mockResolvedValue({ deleted: true });
    vi.mocked(repo.softDelete).mockResolvedValue(true);

    const { createFileDocument } = await import('../services/documents.service');
    await expect(
      createFileDocument(
        fileMeta,
        { body: Buffer.from('%PDF'), mime: 'application/pdf', sizeBytes: 4 },
        adminUser,
        ctx,
      ),
    ).rejects.toThrow();
    expect(r2.deleteObject).toHaveBeenCalled();
    expect(repo.softDelete).toHaveBeenCalledWith(baseFileDoc.id);
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('documents.service.getDocumentFileUrl — signed URL flow', () => {
  it('returns a presigned URL when the doc has a fileKey and actor can view', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseFileDoc,
      fileKey: 'documents/doc-file-1/v1.pdf',
      publishedAt: new Date(),
    });
    vi.mocked(r2.presignGet).mockResolvedValue('https://signed.example/x');
    const { getDocumentFileUrl } = await import('../services/documents.service');
    const url = await getDocumentFileUrl('doc-file-1', recruiterUser);
    expect(url).toBe('https://signed.example/x');
    // The service does NOT pass an explicit TTL — it relies on the R2 client
    // default (300s). Documenting that contract here so anyone tempted to
    // pass `0` or `Infinity` through the service signature trips this test.
    expect(r2.presignGet).toHaveBeenCalledWith('documents/doc-file-1/v1.pdf');
    const ttlArg = vi.mocked(r2.presignGet).mock.calls[0]?.[1];
    expect(ttlArg === undefined || (Number.isFinite(ttlArg) && (ttlArg as number) > 0)).toBe(true);
  });

  it('throws VALIDATION 400 when the doc has no fileKey (markdown-only doc)', async () => {
    vi.mocked(repo.findById).mockResolvedValue({ ...baseDoc, fileKey: null });
    const { getDocumentFileUrl } = await import('../services/documents.service');
    await expect(
      getDocumentFileUrl('doc-1', recruiterUser),
    ).rejects.toMatchObject({
      status: 400,
      meta: expect.objectContaining({ reason: 'document_has_no_file' }),
    });
    expect(r2.presignGet).not.toHaveBeenCalled();
  });

  it('throws NotFound when the doc id does not exist', async () => {
    vi.mocked(repo.findById).mockResolvedValue(undefined);
    const { getDocumentFileUrl } = await import('../services/documents.service');
    await expect(getDocumentFileUrl('doc-x', recruiterUser)).rejects.toThrow(NotFoundError);
    expect(r2.presignGet).not.toHaveBeenCalled();
  });

  it('throws Forbidden when actor.role is NOT in visibleToRoles', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseFileDoc,
      visibleToRoles: ['admin'],
    });
    const { getDocumentFileUrl } = await import('../services/documents.service');
    await expect(getDocumentFileUrl('doc-file-1', recruiterUser)).rejects.toThrow(ForbiddenError);
    expect(r2.presignGet).not.toHaveBeenCalled();
  });
});

describe('documents.service.getDocumentBySlug + getDocumentByIdAdmin (visibility & admin guard)', () => {
  it('getDocumentBySlug returns the row when visible to the actor', async () => {
    vi.mocked(repo.findBySlug).mockResolvedValue(baseDoc);
    const { getDocumentBySlug } = await import('../services/documents.service');
    const row = await getDocumentBySlug('regulamin-crm', recruiterUser);
    expect(row.id).toBe('doc-1');
  });

  it('getDocumentBySlug throws NotFound when slug is unknown', async () => {
    vi.mocked(repo.findBySlug).mockResolvedValue(undefined);
    const { getDocumentBySlug } = await import('../services/documents.service');
    await expect(getDocumentBySlug('missing', recruiterUser)).rejects.toThrow(NotFoundError);
  });

  it('getDocumentBySlug throws Forbidden when role is not in visibleToRoles', async () => {
    vi.mocked(repo.findBySlug).mockResolvedValue({ ...baseDoc, visibleToRoles: ['admin'] });
    const { getDocumentBySlug } = await import('../services/documents.service');
    await expect(getDocumentBySlug('regulamin-crm', recruiterUser)).rejects.toThrow(ForbiddenError);
  });

  it('getDocumentByIdAdmin rejects non-admins even if they could otherwise view the doc', async () => {
    const { getDocumentByIdAdmin } = await import('../services/documents.service');
    await expect(getDocumentByIdAdmin('doc-1', recruiterUser)).rejects.toThrow(ForbiddenError);
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it('getDocumentByIdAdmin returns the row for admin', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseDoc);
    const { getDocumentByIdAdmin } = await import('../services/documents.service');
    const row = await getDocumentByIdAdmin('doc-1', adminUser);
    expect(row.id).toBe('doc-1');
  });
});

describe('documents.service.listDocuments (visibility filter)', () => {
  it('filters out documents whose visibleToRoles excludes the actor role', async () => {
    vi.mocked(repo.list).mockResolvedValue({
      items: [
        { ...baseDoc, id: 'doc-a', visibleToRoles: ['admin'] },
        { ...baseDoc, id: 'doc-b', visibleToRoles: ['recruiter', 'admin'] },
        { ...baseDoc, id: 'doc-c', visibleToRoles: ['readonly'] },
      ],
      total: 3,
    });
    const { listDocuments } = await import('../services/documents.service');
    const result = await listDocuments(
      { page: 1, pageSize: 50 } as never,
      recruiterUser,
    );
    expect(result.items.map((d) => d.id)).toEqual(['doc-b']);
    // total is the REPO total, not the post-filter count. This is intentional
    // (pagination math stays simple) but worth pinning so we notice if it
    // changes — surfacing post-filter total would force re-querying.
    expect(result.total).toBe(3);
  });
});

describe('documents.service.publishDocument', () => {
  it('non-admin cannot publish', async () => {
    const { publishDocument } = await import('../services/documents.service');
    await expect(publishDocument('doc-1', recruiterUser, ctx)).rejects.toThrow(ForbiddenError);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('throws NotFound when the doc is missing', async () => {
    vi.mocked(repo.findById).mockResolvedValue(undefined);
    const { publishDocument } = await import('../services/documents.service');
    await expect(publishDocument('doc-x', adminUser, ctx)).rejects.toThrow(NotFoundError);
  });

  it('rejects when already published with 409 / already_published', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseDoc); // already has publishedAt
    const { publishDocument } = await import('../services/documents.service');
    await expect(publishDocument('doc-1', adminUser, ctx)).rejects.toMatchObject({
      status: 409,
      meta: expect.objectContaining({ reason: 'already_published' }),
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('sets publishedAt and audits when transitioning a draft', async () => {
    const draft = { ...baseDoc, publishedAt: null };
    vi.mocked(repo.findById).mockResolvedValue(draft);
    vi.mocked(repo.update).mockImplementation(async (_id, patch) => ({
      ...draft,
      ...patch,
    }));
    const { publishDocument } = await import('../services/documents.service');
    const result = await publishDocument('doc-1', adminUser, ctx);
    expect(result.publishedAt).toBeInstanceOf(Date);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'publish_document', entityId: 'doc-1' }),
    );
  });
});

describe('documents.service.softDeleteDocument — role guard', () => {
  it('non-admin cannot soft-delete', async () => {
    const { softDeleteDocument } = await import('../services/documents.service');
    await expect(softDeleteDocument('doc-1', recruiterUser, ctx)).rejects.toThrow(ForbiddenError);
    expect(repo.softDelete).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('documents.service.acceptDocument — visibility & not-found paths', () => {
  it('throws NotFound when document missing', async () => {
    vi.mocked(repo.findById).mockResolvedValue(undefined);
    const { acceptDocument } = await import('../services/documents.service');
    await expect(
      acceptDocument({ documentId: 'doc-x', version: 1 }, recruiterUser, ctx),
    ).rejects.toThrow(NotFoundError);
    expect(accRepo.insert).not.toHaveBeenCalled();
  });

  it('throws Forbidden when actor role not in visibleToRoles', async () => {
    vi.mocked(repo.findById).mockResolvedValue({ ...baseDoc, visibleToRoles: ['admin'] });
    const { acceptDocument } = await import('../services/documents.service');
    await expect(
      acceptDocument({ documentId: 'doc-1', version: 1 }, recruiterUser, ctx),
    ).rejects.toThrow(ForbiddenError);
    expect(accRepo.insert).not.toHaveBeenCalled();
  });
});

describe('documents.service.listAcceptancesForDocument', () => {
  it('rejects non-admin', async () => {
    const { listAcceptancesForDocument } = await import('../services/documents.service');
    await expect(
      listAcceptancesForDocument('doc-1', recruiterUser),
    ).rejects.toThrow(ForbiddenError);
    expect(accRepo.listForDocument).not.toHaveBeenCalled();
  });

  it('proxies to the repo for admin', async () => {
    vi.mocked(accRepo.listForDocument).mockResolvedValue([]);
    const { listAcceptancesForDocument } = await import('../services/documents.service');
    await listAcceptancesForDocument('doc-1', adminUser);
    expect(accRepo.listForDocument).toHaveBeenCalledWith('doc-1');
  });
});

describe('documents.service.updateDocument — extras', () => {
  it('non-admin cannot update', async () => {
    const { updateDocument } = await import('../services/documents.service');
    await expect(
      updateDocument('doc-1', { title: 'X' }, recruiterUser, ctx),
    ).rejects.toThrow(ForbiddenError);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('throws NotFound when existing row missing', async () => {
    vi.mocked(repo.findById).mockResolvedValue(undefined);
    const { updateDocument } = await import('../services/documents.service');
    await expect(updateDocument('doc-x', { title: 'X' }, adminUser, ctx)).rejects.toThrow(
      NotFoundError,
    );
  });
});
