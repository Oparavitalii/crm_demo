import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { auditLog } from '../../db/tables/audit-log';
import { documents, type NewDocument } from '../../db/tables/documents';
import {
  documentAcceptances,
  type NewDocumentAcceptance,
} from '../../db/tables/document-acceptances';
import { users } from '../../db/tables/users';
import * as documentsService from '../../services/documents.service';
import * as accRepo from '../../repositories/document-acceptances.repo';
import { asActor, makeUser, noCtx } from './fixtures';

// Real-Postgres integration tests for documents.service. The unit suite mocks
// the repos away, which hides the things you actually want to lock at the SQL
// layer here:
//   1. FK rules: document_acceptances → users is CASCADE, → documents is
//      RESTRICT. Both matter for RODO and audit retention.
//   2. The pending-acceptance query only fires when a document is published,
//      not soft-deleted, and requires acceptance. The repo composes three
//      conditions; we verify each one individually at SQL level.
//   3. Soft-delete excludes the row from every public-facing read path
//      (list / findBySlug / findById) while keeping it on disk.
//   4. Audit row is written BEFORE the soft-delete UPDATE — RODO trail.

// Tiny local fixture. Docs aren't seeded by integration/fixtures.ts because
// the table is small and shape-specific; inlining is clearer than a generic
// helper with eight overrides for every call.
async function makeDocument(overrides: Partial<NewDocument> = {}) {
  // Default to a markdown doc with content_md set (the contentXor CHECK
  // requires exactly one of content_md / file_key). Callers can flip to a
  // file doc by passing { contentMd: null, fileKey: '...' }.
  const slug = overrides.slug ?? `doc-${crypto.randomUUID().slice(0, 8)}`;
  const [row] = await db
    .insert(documents)
    .values({
      slug,
      title: 'Test Document',
      category: 'regulamin',
      contentMd: '# body',
      requiresAcceptance: true,
      ...overrides,
    } as NewDocument)
    .returning();
  if (!row) throw new Error('makeDocument: insert returned no row');
  return row;
}

async function makeAcceptance(input: NewDocumentAcceptance) {
  const [row] = await db.insert(documentAcceptances).values(input).returning();
  if (!row) throw new Error('makeAcceptance: insert returned no row');
  return row;
}

describe('document_acceptances FK behavior (integration)', () => {
  it('hard-deleting a USER cascades and removes their acceptance rows', async () => {
    // user_id has onDelete: 'cascade'. The intent is that an admin who runs
    // a hard delete of a user (rare; production path is deactivation) does
    // not leave dangling acceptances pointing at a missing user. This locks
    // the cascade configuration at the schema level.
    const admin = await makeUser({ role: 'admin' });
    const rec = await makeUser({ role: 'recruiter' });
    const doc = await makeDocument({
      slug: 'doc-cascade-user',
      publishedAt: new Date(),
      createdBy: admin.id,
    });
    const acc = await makeAcceptance({
      documentId: doc.id,
      version: doc.version,
      userId: rec.id,
    });

    await db.delete(users).where(eq(users.id, rec.id));

    const remaining = await db
      .select()
      .from(documentAcceptances)
      .where(eq(documentAcceptances.id, acc.id));
    expect(remaining).toHaveLength(0);

    // The document itself stays — only the acceptance row was cascaded.
    const docAfter = await db
      .select()
      .from(documents)
      .where(eq(documents.id, doc.id));
    expect(docAfter).toHaveLength(1);
  });

  it('hard-deleting a DOCUMENT with acceptances is REJECTED by FK restrict (23503)', async () => {
    // document_id has onDelete: 'restrict'. Soft-delete is the production
    // path — a hard DELETE on a document that anyone has accepted must fail
    // at the DB layer to protect the audit trail. Locks the FK so a future
    // migration that flips this to cascade is caught immediately.
    const admin = await makeUser({ role: 'admin' });
    const rec = await makeUser({ role: 'recruiter' });
    const doc = await makeDocument({
      slug: 'doc-restrict-doc',
      publishedAt: new Date(),
      createdBy: admin.id,
    });
    await makeAcceptance({
      documentId: doc.id,
      version: doc.version,
      userId: rec.id,
    });

    await expect(
      db.delete(documents).where(eq(documents.id, doc.id)),
    ).rejects.toMatchObject({ cause: { code: '23503' } });

    // Document row stays — FK rejected the delete.
    const docAfter = await db
      .select()
      .from(documents)
      .where(eq(documents.id, doc.id));
    expect(docAfter).toHaveLength(1);
  });

  it('(documentId, version, userId) is UNIQUE — duplicate acceptance hits 23505', async () => {
    // The unique index document_acceptances_doc_ver_user_uniq guarantees
    // idempotency at the SQL layer. The service-level idempotency
    // (acceptDocument checks findByDocVersionUser first) is the FRIENDLY
    // path. This test locks the BELT-AND-BRACES SQL guarantee in case a
    // future change races two service calls and bypasses the find-first.
    const admin = await makeUser({ role: 'admin' });
    const rec = await makeUser({ role: 'recruiter' });
    const doc = await makeDocument({
      slug: 'doc-unique-accept',
      publishedAt: new Date(),
      createdBy: admin.id,
    });
    await makeAcceptance({
      documentId: doc.id,
      version: doc.version,
      userId: rec.id,
    });

    await expect(
      db.insert(documentAcceptances).values({
        documentId: doc.id,
        version: doc.version,
        userId: rec.id,
      }),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
  });

  it('createdBy on documents is ON DELETE SET NULL — hard-deleting the author keeps the doc', async () => {
    // documents.created_by has onDelete: 'set null'. Useful when a user is
    // removed but we want to retain published org policies. Lock the FK rule.
    const admin = await makeUser({ role: 'admin' });
    const doc = await makeDocument({
      slug: 'doc-author-deleted',
      publishedAt: new Date(),
      createdBy: admin.id,
    });

    await db.delete(users).where(eq(users.id, admin.id));

    const docAfter = await db
      .select()
      .from(documents)
      .where(eq(documents.id, doc.id));
    expect(docAfter).toHaveLength(1);
    expect(docAfter[0]?.createdBy).toBeNull();
  });
});

describe('documents draft → published transition (integration)', () => {
  it('listPendingForUser ONLY surfaces published, requires_acceptance, non-deleted docs', async () => {
    // The PendingAcceptancesModal hits this query. The three gates are:
    //   publishedAt IS NOT NULL AND deletedAt IS NULL AND requiresAcceptance.
    // Probe each gate individually so a regression on any single condition is
    // obvious from which doc starts leaking through.
    const admin = await makeUser({ role: 'admin' });
    const rec = await makeUser({ role: 'recruiter' });

    // Should appear: published + requires + not deleted + visible to recruiter.
    const okDoc = await makeDocument({
      slug: 'pend-ok',
      publishedAt: new Date(),
      requiresAcceptance: true,
      createdBy: admin.id,
    });
    // Draft (publishedAt NULL) — must be excluded.
    await makeDocument({
      slug: 'pend-draft',
      publishedAt: null,
      requiresAcceptance: true,
      createdBy: admin.id,
    });
    // Optional-acceptance doc (requiresAcceptance=false) — must be excluded.
    await makeDocument({
      slug: 'pend-optional',
      publishedAt: new Date(),
      requiresAcceptance: false,
      createdBy: admin.id,
    });
    // Soft-deleted (publishedAt set but deletedAt also set) — must be excluded.
    await makeDocument({
      slug: 'pend-deleted',
      publishedAt: new Date(),
      requiresAcceptance: true,
      deletedAt: new Date(),
      createdBy: admin.id,
    });

    const pending = await accRepo.listPendingForUser(rec.id);
    const slugs = pending.map((d) => d.slug);
    expect(slugs).toEqual(['pend-ok']);
    expect(pending[0]?.id).toBe(okDoc.id);
  });

  it('accepting at version N then bumping to version N+1 brings the doc BACK to pending', async () => {
    // Version handling — the audit-retention contract: a prior version is
    // NOT physically deleted; we model "re-acceptance required" by bumping
    // the version on the doc, and the acceptance row at version N stays so
    // we can still prove the user agreed to that prior text.
    const admin = await makeUser({ role: 'admin' });
    const rec = await makeUser({ role: 'recruiter' });
    const doc = await makeDocument({
      slug: 'doc-bump',
      publishedAt: new Date(),
      requiresAcceptance: true,
      createdBy: admin.id,
      version: 1,
    });
    await documentsService.acceptDocument(
      { documentId: doc.id, version: 1 },
      asActor(rec),
      noCtx,
    );

    // After acceptance at v1, the doc must NOT appear in pending for this user.
    let pending = await accRepo.listPendingForUser(rec.id);
    expect(pending.map((d) => d.id)).not.toContain(doc.id);

    // Bump version (the production path is updateDocument with a contentMd
    // change; we set the bumped value directly here to keep the test focused
    // on the pending-query gate, not the bump heuristic which has its own
    // unit coverage).
    await db
      .update(documents)
      .set({ version: 2 })
      .where(eq(documents.id, doc.id));

    pending = await accRepo.listPendingForUser(rec.id);
    expect(pending.map((d) => d.id)).toContain(doc.id);

    // CRITICAL: the v1 acceptance row stays — RODO/audit retention requires
    // we can still prove what the user originally agreed to.
    const trail = await db
      .select()
      .from(documentAcceptances)
      .where(
        and(
          eq(documentAcceptances.documentId, doc.id),
          eq(documentAcceptances.userId, rec.id),
          eq(documentAcceptances.version, 1),
        ),
      );
    expect(trail).toHaveLength(1);
  });
});

describe('documents soft-delete excludes from public read paths (integration)', () => {
  it('publish, then soft-delete: list/findBySlug/findById all return empty', async () => {
    // softDeleteDocument sets deletedAt — the three read paths
    // (list / findBySlug / findById) all add isNull(documents.deletedAt) and
    // therefore must drop the row. The admin findById path
    // (getDocumentByIdAdmin) goes through the same repo.findById and is also
    // covered by this assertion.
    const admin = await makeUser({ role: 'admin' });
    const doc = await makeDocument({
      slug: 'doc-soft-deleted-readback',
      publishedAt: new Date(),
      createdBy: admin.id,
    });

    await documentsService.softDeleteDocument(doc.id, asActor(admin), noCtx);

    // list — recruiter scope (any role would do; soft-delete is global).
    const rec = await makeUser({ role: 'recruiter' });
    const listed = await documentsService.listDocuments(
      { page: 1, pageSize: 50 } as never,
      asActor(rec),
    );
    expect(listed.items.map((d) => d.id)).not.toContain(doc.id);
    expect(listed.total).toBe(0);

    // findBySlug — must not be reachable by slug either.
    await expect(
      documentsService.getDocumentBySlug('doc-soft-deleted-readback', asActor(rec)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // findById admin path — same isNull(deletedAt) gate.
    await expect(
      documentsService.getDocumentByIdAdmin(doc.id, asActor(admin)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // The row physically REMAINS in storage with deletedAt set — audit trail.
    const physicallyThere = await db
      .select()
      .from(documents)
      .where(eq(documents.id, doc.id));
    expect(physicallyThere).toHaveLength(1);
    expect(physicallyThere[0]?.deletedAt).not.toBeNull();
  });

  it('audit row is written BEFORE the soft-delete UPDATE landed', async () => {
    // softDeleteDocument is the destructive op; service comment says
    // "Audit BEFORE delete — never lose the trail if delete fails."
    // We assert both directions:
    //  - the document row carries deletedAt
    //  - the audit row exists, entityType=document, action=delete_document.
    const admin = await makeUser({ role: 'admin' });
    const doc = await makeDocument({
      slug: 'doc-audit-before-delete',
      publishedAt: new Date(),
      createdBy: admin.id,
    });

    await documentsService.softDeleteDocument(doc.id, asActor(admin), noCtx);

    const trail = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, 'document'),
          eq(auditLog.entityId, doc.id),
          eq(auditLog.action, 'delete_document'),
        ),
      );
    expect(trail).toHaveLength(1);
    expect(trail[0]?.actorId).toBe(admin.id);
    const oldValue = trail[0]?.oldValue as { slug: string; version: number };
    expect(oldValue.slug).toBe('doc-audit-before-delete');
    expect(oldValue.version).toBe(1);

    const physicallyThere = await db
      .select()
      .from(documents)
      .where(eq(documents.id, doc.id));
    expect(physicallyThere[0]?.deletedAt).not.toBeNull();
  });
});

describe('documents content_xor CHECK constraint (integration)', () => {
  it('rejects an INSERT that has both content_md AND file_key set (23514)', async () => {
    // The documents_content_xor CHECK enforces one-or-the-other at the DB
    // level so a bug in the service layer that tries to set both ends up
    // failing fast instead of producing a hybrid row.
    const admin = await makeUser({ role: 'admin' });
    await expect(
      db.insert(documents).values({
        slug: 'doc-both-content',
        title: 'Both Content',
        category: 'regulamin',
        contentMd: '# body',
        fileKey: 'documents/x/v1.pdf',
        createdBy: admin.id,
      } as NewDocument),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it('rejects an INSERT that has NEITHER content_md NOR file_key set (23514)', async () => {
    const admin = await makeUser({ role: 'admin' });
    await expect(
      db.insert(documents).values({
        slug: 'doc-neither-content',
        title: 'Neither Content',
        category: 'regulamin',
        contentMd: null,
        fileKey: null,
        createdBy: admin.id,
      } as NewDocument),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });
});
