import * as repo from '../repositories/candidate-comments.repo';
import type { EnrichedCandidateComment } from '../repositories/candidate-comments.repo';
import * as candidatesService from './candidates.service';
import * as audit from './audit.service';
import { ForbiddenError, NotFoundError } from '../lib/errors';
import type { CreateCandidateCommentInput } from '@opushr/shared';

interface Actor {
  id: string;
  role: 'admin' | 'recruiter' | 'coordinator' | 'readonly';
}
interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
}

// All operations delegate the per-candidate visibility check to
// `candidatesService.getCandidate`, which throws NotFoundError if the actor
// can't see the candidate (recruiter/coordinator scope). This keeps the RBAC
// logic single-sourced — no duplicated `canSee` here.
async function assertCanAccessCandidate(
  candidateId: string,
  actor: Actor,
): Promise<void> {
  // Throws NotFoundError if hidden — propagate as-is.
  await candidatesService.getCandidate(candidateId, actor);
}

export async function listComments(
  candidateId: string,
  actor: Actor,
): Promise<{ items: EnrichedCandidateComment[]; total: number }> {
  await assertCanAccessCandidate(candidateId, actor);
  const items = await repo.listByCandidate(candidateId);
  return { items, total: items.length };
}

export async function createComment(
  candidateId: string,
  input: CreateCandidateCommentInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<EnrichedCandidateComment> {
  await assertCanAccessCandidate(candidateId, actor);
  const row = await repo.insert({
    candidateId,
    authorId: actor.id,
    body: input.body,
  });

  // Body in audit is OK — it's a deliberate user-typed comment, not PII
  // extracted from the candidate record.
  await audit.log({
    actorId: actor.id,
    action: 'create_candidate_comment',
    entityType: 'candidate_comment',
    entityId: row.id,
    newValue: { candidateId, body: row.body },
    ...ctx,
  });

  return row;
}

export async function deleteComment(
  commentId: string,
  actor: Actor,
  ctx: ReqCtx,
): Promise<void> {
  const existing = await repo.findById(commentId);
  if (!existing) throw new NotFoundError('candidate_comment');

  // Admins can delete any comment. Otherwise only the original author may.
  // We deliberately do NOT check candidate-scope here — once a comment exists,
  // the only deletion privileges are admin OR author. A recruiter who lost
  // access to a candidate shouldn't be able to wipe their own past comment,
  // but they shouldn't be locked out either if they're the author.
  if (actor.role !== 'admin' && existing.authorId !== actor.id) {
    throw new ForbiddenError('not your comment');
  }

  // Audit BEFORE remove (RODO traceability — docs/Engineering_Rules.md).
  await audit.log({
    actorId: actor.id,
    action: 'delete_candidate_comment',
    entityType: 'candidate_comment',
    entityId: commentId,
    oldValue: {
      candidateId: existing.candidateId,
      authorId: existing.authorId,
      body: existing.body,
    },
    ...ctx,
  });

  await repo.remove(commentId);
}
