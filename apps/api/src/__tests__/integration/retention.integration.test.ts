import { describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { candidates } from '../../db/tables/candidates';
import { auditLog } from '../../db/tables/audit-log';
import { runRetention } from '../../cron/retention';
import { makeCandidate, makeUser } from './fixtures';

// End-to-end RODO retention proof. We seed a candidate whose `updatedAt` is
// ~4 years in the past (older than the 3y window) and run the real cron. The
// real anonymize.service / audit.service / repos all execute against the test
// Neon branch. After the sweep we assert:
//   • the candidate row is scrubbed (name=ANON, phone=null, processingRestricted=true)
//   • an `anonymize_candidate` audit entry exists for that id
//   • a `retention_sweep` audit entry exists with actorId=null + cutoffYears=3
//
// This is the evidence that proves the storage-limitation policy actually
// fires — without it, the answer to "show me your retention policy works"
// is "trust me".

describe('cron/retention (integration)', () => {
  it('end-to-end: candidate inactive > 3y is anonymized and a retention_sweep audit row is written', async () => {
    // Need a recruiter row so the candidate FK is satisfied — fixtures default
    // makeCandidate without a recruiter, which is fine for this test.
    const admin = await makeUser({ role: 'admin' });
    const cand = await makeCandidate({
      recruiterId: admin.id,
      email: 'stale@person.local',
      phone: '+48999111000',
      name: 'Stale Candidate',
      notes: 'should be wiped',
    });

    // Force updatedAt 4 years in the past — the insert path overwrites
    // updatedAt with now(), so we patch it via a follow-up UPDATE that the
    // service layer never goes through.
    await db.execute(
      sql`UPDATE candidates SET updated_at = now() - interval '4 years' WHERE id = ${cand.id}`,
    );

    await runRetention();

    const candAfter = await db
      .select()
      .from(candidates)
      .where(eq(candidates.id, cand.id));
    expect(candAfter).toHaveLength(1);
    expect(candAfter[0]?.name).toBe('ANON');
    expect(candAfter[0]?.phone).toBeNull();
    expect(candAfter[0]?.notes).toBeNull();
    expect(candAfter[0]?.processingRestricted).toBe(true);
    expect(candAfter[0]?.anonymizedAt).not.toBeNull();

    const anonTrail = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, 'candidate'),
          eq(auditLog.entityId, cand.id),
          eq(auditLog.action, 'anonymize_candidate'),
        ),
      );
    expect(anonTrail).toHaveLength(1);
    // Cron passes SYSTEM_ACTOR.id ('00000000-...') as the actor for the
    // anonymize_candidate row — distinguishable from human-driven anonymizations.
    expect(anonTrail[0]?.actorId).toBe('00000000-0000-0000-0000-000000000000');

    const sweepTrail = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, 'retention_sweep'),
          eq(auditLog.entityType, 'system'),
        ),
      );
    expect(sweepTrail).toHaveLength(1);
    expect(sweepTrail[0]?.actorId).toBeNull();
    expect(sweepTrail[0]?.entityId).toBeNull();
    expect(sweepTrail[0]?.userAgent).toBe('cron/retention');
    const newValue = sweepTrail[0]?.newValue as {
      candidatesAnonymized: number;
      batchSize: number;
      cutoffYears: number;
      sourceHash: string;
    };
    expect(newValue.cutoffYears).toBe(3);
    expect(newValue.candidatesAnonymized).toBe(1);
    expect(newValue.batchSize).toBe(1);
  });

  it('end-to-end: candidate updated < 3y ago is LEFT ALONE', async () => {
    const admin = await makeUser({ role: 'admin' });
    const cand = await makeCandidate({
      recruiterId: admin.id,
      email: 'fresh@person.local',
      phone: '+48111222333',
      name: 'Fresh Candidate',
    });

    // 1 year ago — well inside the 3y window.
    await db.execute(
      sql`UPDATE candidates SET updated_at = now() - interval '1 year' WHERE id = ${cand.id}`,
    );

    await runRetention();

    const candAfter = await db
      .select()
      .from(candidates)
      .where(eq(candidates.id, cand.id));
    expect(candAfter[0]?.name).toBe('Fresh Candidate');
    expect(candAfter[0]?.anonymizedAt).toBeNull();
    expect(candAfter[0]?.processingRestricted).toBe(false);

    // No retention_sweep row when batch is empty (locked by the unit test;
    // re-asserted here against the real audit_log table).
    const sweepTrail = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'retention_sweep'));
    expect(sweepTrail).toHaveLength(0);
  });
});
