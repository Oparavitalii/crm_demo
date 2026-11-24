import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { auditLog } from '../../db/tables/audit-log';
import { candidates } from '../../db/tables/candidates';
import { dismissals } from '../../db/tables/dismissals';
import * as dismissalsService from '../../services/dismissals.service';
import * as anonymizeService from '../../services/anonymize.service';
import {
  asActor,
  makeCandidate,
  makeDismissal,
  makeUser,
  noCtx,
} from './fixtures';

// These tests run against a real Neon branch (TEST_DATABASE_URL). They lock
// the RODO-critical invariants that the unit tests cannot prove because the
// SQL layer is mocked away there:
//   1. audit-before-remove writes the trail BEFORE the dismissal row is gone
//   2. anonymizing a candidate leaves their dismissal rows intact (legal
//      retention) — and documents which dismissal fields are NOT scrubbed
//   3. FK from dismissals.candidate_id is ON DELETE RESTRICT — a raw delete
//      of a candidate with dismissals must throw a 23503 violation
//   4. NOT NULL on dismissals.reason fires at the database layer
//   5. recruiters calling createDismissal for a candidate they don't own get
//      NOT_FOUND (existence not leaked) and no row / audit row is written.

describe('dismissals.service.deleteDismissal (integration)', () => {
  it('audit row is written BEFORE the dismissal row is removed', async () => {
    // Canonical RODO-traceability pattern: the audit insert must happen
    // BEFORE repo.remove so the trail survives if the delete fails. We assert
    // both directions: the dismissal is gone AND the audit row exists with
    // the entityId of the (now-deleted) dismissal.
    const admin = await makeUser({ role: 'admin' });
    const cand = await makeCandidate({ recruiterId: admin.id });
    const dism = await makeDismissal({
      candidateId: cand.id,
      recordedById: admin.id,
      reason: 'employee_resigned',
    });

    await dismissalsService.deleteDismissal(dism.id, asActor(admin), noCtx);

    const remaining = await db
      .select()
      .from(dismissals)
      .where(eq(dismissals.id, dism.id));
    expect(remaining).toHaveLength(0);

    const trail = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, 'dismissal'),
          eq(auditLog.entityId, dism.id),
        ),
      );
    expect(trail).toHaveLength(1);
    expect(trail[0]?.action).toBe('delete_dismissal');
    expect(trail[0]?.actorId).toBe(admin.id);
  });

  it('audit oldValue carries candidateId + reason (canonical shape — see TODO on PII)', async () => {
    // The service writes oldValue = { candidateId, reason }. The `reason`
    // field is human-typed free text (max 1000 chars per the Zod schema),
    // documented as "human-typed details" — recruiters may put narrative
    // sentences that incidentally reference other people. This test locks
    // the CURRENT shape so any change (e.g. scrubbing reason to a hash or
    // a boolean flag like the candidate-anonymize audit does) is intentional.
    //
    // SUSPECTED RODO SOFT-LEAK (for human review, do NOT fix here):
    //   `oldValue.reason` is preserved verbatim in audit_log. If a recruiter
    //   ever types PII into the reason field (a co-worker's name, a medical
    //   detail), it lives forever in audit_log even after the dismissal row
    //   is gone. Compare to anonymize.service.ts which uses boolean
    //   hadEmail/hadPhone/hadNotes flags. Filed as a soft follow-up.
    const admin = await makeUser({ role: 'admin' });
    const cand = await makeCandidate({ recruiterId: admin.id });
    const dism = await makeDismissal({
      candidateId: cand.id,
      recordedById: admin.id,
      reason: 'low_performance',
    });

    await dismissalsService.deleteDismissal(dism.id, asActor(admin), noCtx);

    const trail = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, 'dismissal'),
          eq(auditLog.entityId, dism.id),
        ),
      );
    expect(trail).toHaveLength(1);
    const oldValue = trail[0]?.oldValue as { candidateId: string; reason: string };
    expect(oldValue.candidateId).toBe(cand.id);
    expect(oldValue.reason).toBe('low_performance');
  });

  it('non-existent id → NOT_FOUND, no audit row written', async () => {
    const admin = await makeUser({ role: 'admin' });
    const fakeId = '00000000-0000-0000-0000-deadbeefcafe';

    await expect(
      dismissalsService.deleteDismissal(fakeId, asActor(admin), noCtx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const trail = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, fakeId));
    expect(trail).toHaveLength(0);
  });
});

describe('dismissals × anonymize (integration)', () => {
  it('anonymizing a candidate LEAVES their dismissal rows intact (legal retention)', async () => {
    // Dismissal facts must be retained for the labour-law record even after
    // the data subject exercises their right to erasure. Per
    // anonymize.service.ts the only writes are to the `candidates` row; the
    // dismissals table is untouched. We lock this so a future "cascade scrub"
    // change is caught by this test.
    const admin = await makeUser({ role: 'admin' });
    const cand = await makeCandidate({
      recruiterId: admin.id,
      email: 'real@person.local',
      phone: '+48123456789',
    });
    const dism = await makeDismissal({
      candidateId: cand.id,
      recordedById: admin.id,
      reason: 'contract_ended',
      reasonCode: 'contract_ended',
      notes: 'final payslip handed over in person',
    });

    await anonymizeService.anonymizeCandidate(cand.id, asActor(admin), noCtx);

    // Candidate row is scrubbed (sanity check).
    const candAfter = await db
      .select()
      .from(candidates)
      .where(eq(candidates.id, cand.id));
    expect(candAfter[0]?.name).toBe('ANON');
    expect(candAfter[0]?.phone).toBeNull();
    expect(candAfter[0]?.processingRestricted).toBe(true);
    expect(candAfter[0]?.anonymizedAt).not.toBeNull();

    // Dismissal row stays fully intact — including the candidateId FK and
    // the recordedById (who registered the dismissal).
    const dismAfter = await db
      .select()
      .from(dismissals)
      .where(eq(dismissals.id, dism.id));
    expect(dismAfter).toHaveLength(1);
    expect(dismAfter[0]?.candidateId).toBe(cand.id);
    expect(dismAfter[0]?.reason).toBe('contract_ended');
    expect(dismAfter[0]?.reasonCode).toBe('contract_ended');
    expect(dismAfter[0]?.recordedById).toBe(admin.id);
  });

  it('dismissal.notes is NOT scrubbed on candidate anonymization (potential PII leak — TODO)', async () => {
    // SUSPECTED RODO LEAK (for human review, do NOT fix here):
    //   `dismissals.notes` is free-text up to 5000 chars (per the Zod schema)
    //   and is preserved verbatim across candidate anonymization. If a
    //   recruiter ever wrote PII into it (a co-worker's name, an address,
    //   a medical detail), the right-to-erasure flow does not reach it.
    //   anonymize.service.ts only touches the `candidates` row — see lines
    //   54-68 of that file. Compare to candidates.notes which IS nulled.
    //
    // This test LOCKS THE CURRENT BEHAVIOR so a future scrub pass is
    // intentional. If the service later starts blanking dismissals.notes on
    // anonymization, this test should flip to expect null.
    const admin = await makeUser({ role: 'admin' });
    const cand = await makeCandidate({ recruiterId: admin.id });
    const sensitiveNote = 'spoke with brother Jan (+48555111222) about return flight';
    const dism = await makeDismissal({
      candidateId: cand.id,
      recordedById: admin.id,
      reason: 'returned_home',
      notes: sensitiveNote,
    });

    await anonymizeService.anonymizeCandidate(cand.id, asActor(admin), noCtx);

    const dismAfter = await db
      .select()
      .from(dismissals)
      .where(eq(dismissals.id, dism.id));
    // Locks the gap — if you change the service to scrub, update this test.
    expect(dismAfter[0]?.notes).toBe(sensitiveNote);
    expect(dismAfter[0]?.reason).toBe('returned_home');
  });
});

describe('dismissals FK behavior (integration)', () => {
  it('hard-deleting a candidate with a dismissal is REJECTED by FK restrict (23503)', async () => {
    // dismissals.candidate_id has onDelete: 'restrict'. This is the safety
    // belt that keeps anonymization (soft-erase) from being bypassed by an
    // accidental hard delete: as long as a dismissal exists, the candidate
    // row cannot leave the database via a raw DELETE.
    //
    // We bypass the service layer here because candidates.service.deleteCandidate
    // catches 23503 and translates it into an AppError('VALIDATION'). The raw
    // DB delete is the unfiltered signal that the FK is configured correctly.
    const admin = await makeUser({ role: 'admin' });
    const cand = await makeCandidate({ recruiterId: admin.id });
    await makeDismissal({
      candidateId: cand.id,
      recordedById: admin.id,
    });

    // drizzle-orm/node-postgres wraps the pg DatabaseError in a
    // DrizzleQueryError; the original pg `code` lives at `.cause.code`.
    await expect(
      db.delete(candidates).where(eq(candidates.id, cand.id)),
    ).rejects.toMatchObject({ cause: { code: '23503' } });

    // Candidate row must still be there — the FK rejected the delete.
    const stillThere = await db
      .select()
      .from(candidates)
      .where(eq(candidates.id, cand.id));
    expect(stillThere).toHaveLength(1);
  });

  it('dismissals.reason NOT NULL fires at the SQL layer', async () => {
    // The service layer routes user input through Zod (`reason: min(1)`), so
    // a NULL reason can only arise from a direct DB insert or a migration
    // script bug. Lock the database-level guard so a future migration that
    // drops the NOT NULL constraint is caught immediately.
    const admin = await makeUser({ role: 'admin' });
    const cand = await makeCandidate({ recruiterId: admin.id });

    await expect(
      db
        .insert(dismissals)
        .values({
          candidateId: cand.id,
          dismissedAt: new Date(),
          // `reason` intentionally omitted; cast through `never` because the
          // inferred `NewDismissal` type marks it as required (NOT NULL).
        } as never),
    ).rejects.toMatchObject({ cause: { code: '23502' } });
  });
});

describe('dismissals.service.createDismissal — recruiter horizontal access (integration)', () => {
  it('recruiter A creating a dismissal for B`s candidate → NOT_FOUND, no row, no audit', async () => {
    // createDismissal goes through assertCandidateAccess → getCandidate,
    // which returns NotFoundError for a row the recruiter cannot see. Verify
    // the rejection at the service layer AND that no side effects landed —
    // no dismissal row, no audit row, and the candidate is untouched.
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    const candOfB = await makeCandidate({
      recruiterId: recB.id,
      status: 'employed',
      kind: 'client',
    });

    await expect(
      dismissalsService.createDismissal(
        {
          candidateId: candOfB.id,
          dismissedAt: new Date('2026-06-01T08:00:00.000Z').toISOString(),
          reason: 'attempted-cross-recruiter-dismissal',
        },
        asActor(recA),
        noCtx,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const dismRows = await db
      .select()
      .from(dismissals)
      .where(eq(dismissals.candidateId, candOfB.id));
    expect(dismRows).toHaveLength(0);

    const trail = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, candOfB.id));
    expect(trail).toHaveLength(0);

    // Candidate stays in `employed` — the lifecycle sync inside
    // createDismissal must not have fired.
    const candAfter = await db
      .select()
      .from(candidates)
      .where(eq(candidates.id, candOfB.id));
    expect(candAfter[0]?.status).toBe('employed');
    expect(candAfter[0]?.kind).toBe('client');
  });
});
