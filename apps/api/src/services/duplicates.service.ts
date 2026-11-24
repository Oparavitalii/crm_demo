import type { Candidate as CandidateRow } from '../db/tables/candidates';
import * as candidatesRepo from '../repositories/candidates.repo';
import * as ignoresRepo from '../repositories/duplicate-ignores.repo';
import * as audit from './audit.service';
import { NotFoundError } from '../lib/errors';
import { shouldScopeToRecruiter } from '../lib/scope';
import type { DuplicateRecord } from '@crm/shared';

interface Actor {
  id: string;
  role: 'admin' | 'recruiter' | 'coordinator' | 'readonly';
}
interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
}

function candidateToMatch(c: CandidateRow, target: CandidateRow): DuplicateRecord {
  const matchedBy: DuplicateRecord['matchedBy'] = [];
  if (target.email && c.email && c.email.toLowerCase() === target.email.toLowerCase()) {
    matchedBy.push('email');
  }
  if (target.phone && c.phone && c.phone === target.phone) {
    matchedBy.push('phone');
  }
  if (c.name.toLowerCase() === target.name.toLowerCase()) {
    matchedBy.push('name');
  }
  return {
    id: c.id,
    matchedBy,
    displayName: c.name,
    email: c.email,
    phone: c.phone,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function getCandidateDuplicates(
  id: string,
  user: Actor,
): Promise<DuplicateRecord[]> {
  const target = await candidatesRepo.findById(id);
  if (!target) throw new NotFoundError('candidate');
  if (
    shouldScopeToRecruiter(user.role) &&
    target.recruiterId !== null &&
    target.recruiterId !== user.id
  ) {
    throw new NotFoundError('candidate');
  }

  const dups = await candidatesRepo.findDuplicatesOf(id);
  return dups.map((c) => candidateToMatch(c, target));
}

// 2026-06-12: leads entity retired. Only candidate-type marks remain.
export async function markNotDuplicate(
  input: { entityType: 'candidate'; idA: string; idB: string },
  user: Actor,
  ctx: ReqCtx,
): Promise<void> {
  await ignoresRepo.add({
    entityType: input.entityType,
    idA: input.idA,
    idB: input.idB,
    createdById: user.id,
  });
  await audit.log({
    actorId: user.id,
    action: 'mark_not_duplicate',
    entityType: input.entityType,
    entityId: input.idA,
    newValue: { otherId: input.idB },
    ...ctx,
  });
}
