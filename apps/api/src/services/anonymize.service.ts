import { db } from '../db/client';
import { candidates } from '../db/tables/candidates';
import { eq } from 'drizzle-orm';
import * as candidatesRepo from '../repositories/candidates.repo';
import * as audit from './audit.service';
import { ForbiddenError, NotFoundError } from '../lib/errors';
import { sha256 } from '../lib/hash';

interface Actor {
  id: string;
  role: 'admin' | 'recruiter' | 'coordinator' | 'readonly';
}

interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
}

export interface AnonymizeResult {
  alreadyAnonymized: boolean;
  anonymizedAt: string | null;
}

export async function anonymizeCandidate(
  id: string,
  actor: Actor,
  ctx: ReqCtx,
): Promise<AnonymizeResult> {
  if (actor.role !== 'admin') throw new ForbiddenError('admin only');

  const candidate = await candidatesRepo.findById(id);
  if (!candidate) throw new NotFoundError('candidate');

  // Idempotency: already anonymized → no-op, return flag
  if (candidate.anonymizedAt !== null) {
    await audit.log({
      actorId: actor.id,
      action: 'anonymize_candidate',
      entityType: 'candidate',
      entityId: id,
      oldValue: { alreadyAnonymized: true },
      newValue: { anonymizedAt: candidate.anonymizedAt.toISOString() },
      ...ctx,
    });
    return {
      alreadyAnonymized: true,
      anonymizedAt: candidate.anonymizedAt.toISOString(),
    };
  }

  const hash = sha256(candidate.id).slice(0, 16);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(candidates)
      .set({
        name: 'ANON',
        email: `anon_${hash}@anonymized.local`,
        phone: null,
        birthDate: null,
        nationality: null,
        notes: null,
        anonymizedAt: now,
        processingRestricted: true,
        updatedAt: now,
      })
      .where(eq(candidates.id, id));

    await audit.log({
      actorId: actor.id,
      action: 'anonymize_candidate',
      entityType: 'candidate',
      entityId: id,
      // RODO: do NOT include PII being erased. Use boolean flags only.
      oldValue: {
        hadEmail: true,
        hadPhone: candidate.phone !== null,
        hadNotes: candidate.notes !== null,
      },
      newValue: { anonymizedAt: now.toISOString() },
      ...ctx,
    });
  });

  return { alreadyAnonymized: false, anonymizedAt: now.toISOString() };
}
