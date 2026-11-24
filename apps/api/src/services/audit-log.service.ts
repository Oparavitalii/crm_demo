import * as repo from '../repositories/audit-log.repo';
import * as consentHistoryRepo from '../repositories/consent-history.repo';
import { ForbiddenError } from '../lib/errors';
import type {
  ConsentHistoryItem,
  ListAuditLogQuery,
  ListConsentHistoryQuery,
} from '@opushr/shared';
import type { AuditLogEntry } from '../db/tables/audit-log';

interface Actor {
  id: string;
  role: 'admin' | 'recruiter' | 'coordinator' | 'readonly';
}

export async function listAuditLog(
  query: ListAuditLogQuery,
  actor: Actor,
): Promise<{ items: AuditLogEntry[]; total: number; page: number; pageSize: number }> {
  if (actor.role !== 'admin') throw new ForbiddenError('admin only');

  const { items, total } = await repo.list(query);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

// "Історія згод" tab — one row per consent record (grant + optional withdraw).
export async function listConsentHistory(
  query: ListConsentHistoryQuery,
  actor: Actor,
): Promise<{ items: ConsentHistoryItem[]; total: number; page: number; pageSize: number }> {
  if (actor.role !== 'admin') throw new ForbiddenError('admin only');
  const { items, total } = await consentHistoryRepo.list(query);
  return { items, total, page: query.page, pageSize: query.pageSize };
}
