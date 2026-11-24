import * as candidatesRepo from '../repositories/candidates.repo';
import * as dismissalsRepo from '../repositories/dismissals.repo';
import * as auditLogRepo from '../repositories/audit-log.repo';
import { db } from '../db/client';
import { messages } from '../db/tables/messages';
import { consents } from '../db/tables/consents';
import { eq } from 'drizzle-orm';
import { ForbiddenError, NotFoundError } from '../lib/errors';
import type { Candidate } from '../db/tables/candidates';
import type { Dismissal } from '../db/tables/dismissals';
import type { Message } from '../db/tables/messages';
import type { AuditLogEntry } from '../db/tables/audit-log';
import type { Consent } from '../db/tables/consents';

interface Actor {
  id: string;
  role: 'admin' | 'recruiter' | 'coordinator' | 'readonly';
}

export interface CandidateExport {
  candidate: Candidate;
  dismissals: Dismissal[];
  messages: Message[];
  auditLog: AuditLogEntry[];
  consent: Consent | null;
}

export async function exportCandidate(id: string, actor: Actor): Promise<CandidateExport> {
  if (actor.role !== 'admin') throw new ForbiddenError('admin only');

  const candidate = await candidatesRepo.findById(id);
  if (!candidate) throw new NotFoundError('candidate');

  const [dismissalsList, messagesList] = await Promise.all([
    dismissalsRepo.listByCandidate(id),
    db.query.messages.findMany({ where: eq(messages.candidateId, id) }),
  ]);

  // C-1 + C-2: collect all entity IDs pertaining to this candidate and fetch
  // their audit entries in one query — no pagination cap, complete RODO export.
  const dismissalIds = dismissalsList.map((d) => d.id);
  const messageIds = messagesList.map((m) => m.id);
  const allRelatedEntityIds = [id, ...dismissalIds, ...messageIds];
  const auditLogEntries = await auditLogRepo.listByEntityIds(allRelatedEntityIds);

  let consent: Consent | null = null;
  if (candidate.consentId) {
    consent = (await db.query.consents.findFirst({ where: eq(consents.id, candidate.consentId) })) ?? null;
  }

  return {
    candidate,
    dismissals: dismissalsList,
    messages: messagesList,
    auditLog: auditLogEntries,
    consent,
  };
}
