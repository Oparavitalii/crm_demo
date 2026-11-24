// RODO retention sweep. Runs daily from cron/scheduler.ts.
// Each step is independent and isolated — a failure in one does NOT abort
// the others. Stats are logged per-step so a missed run shows up in Fly logs.
import { logger } from '../lib/logger';
import { sha256 } from '../lib/hash';
import * as sessionsRepo from '../repositories/sessions.repo';
import * as resetRepo from '../repositories/password-reset-tokens.repo';
import * as auditLogRepo from '../repositories/audit-log.repo';
import * as candidatesRepo from '../repositories/candidates.repo';
import * as audit from '../services/audit.service';
import { anonymizeCandidate } from '../services/anonymize.service';

// RODO retention windows. Centralized so the values appear in exactly one
// place and any future regulatory change is a single-line edit.
const INACTIVE_CANDIDATE_YEARS = 3;
const AUDIT_LOG_YEARS = 5;
const ANONYMIZE_BATCH_LIMIT = 200;

// Synthetic actor for cron-initiated anonymization. Not a person: the id maps
// to the inactive system row created by migration 0058_system_actor_user.sql,
// which exists only to satisfy audit_log.actor_id's foreign key. The
// anonymize_candidate audit rows carry this id, which makes them
// distinguishable from human-driven anonymizations.
const SYSTEM_ACTOR = {
  id: '00000000-0000-0000-0000-000000000000',
  role: 'admin' as const,
};

async function step(name: string, fn: () => Promise<Record<string, unknown>>): Promise<void> {
  try {
    const result = await fn();
    logger.info({ step: name, ...result }, 'retention_step_ok');
  } catch (err) {
    logger.error({ err, step: name }, 'retention_step_failed');
  }
}

export async function runRetention(): Promise<void> {
  logger.info('retention_started');

  await step('delete_expired_sessions', async () => {
    const deleted = await sessionsRepo.deleteExpired();
    return { deleted };
  });

  await step('delete_rotated_session_tombstones', async () => {
    // Rotation keeps the old session row as a tombstone (grace window +
    // reuse detection). 24h is far above both the 60s grace and the 15-min
    // access TTL, so sweeping here can never break a live client.
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const deleted = await sessionsRepo.deleteRotatedBefore(cutoff);
    return { deleted, cutoff: cutoff.toISOString() };
  });

  await step('delete_expired_reset_tokens', async () => {
    const deleted = await resetRepo.deleteExpired();
    return { deleted };
  });

  await step('purge_old_audit_log', async () => {
    const cutoff = yearsAgo(AUDIT_LOG_YEARS);
    const deleted = await auditLogRepo.purgeOlderThan(cutoff);
    return { deleted, cutoff: cutoff.toISOString() };
  });

  await step('anonymize_inactive_candidates', async () => {
    const cutoff = yearsAgo(INACTIVE_CANDIDATE_YEARS);
    const ids = await candidatesRepo.findInactiveCandidateIds(cutoff, ANONYMIZE_BATCH_LIMIT);
    let anonymized = 0;
    for (const id of ids) {
      try {
        const res = await anonymizeCandidate(id, SYSTEM_ACTOR, {
          ip: null,
          userAgent: 'cron/retention',
        });
        if (!res.alreadyAnonymized) anonymized += 1;
      } catch (err) {
        // One candidate's failure must not stop the batch. Log + continue.
        logger.error({ err, candidateId: id }, 'retention_anonymize_one_failed');
      }
    }
    if (ids.length > 0) {
      await audit.log({
        actorId: null,
        action: 'retention_sweep',
        entityType: 'system',
        entityId: null,
        newValue: {
          candidatesAnonymized: anonymized,
          batchSize: ids.length,
          cutoffYears: INACTIVE_CANDIDATE_YEARS,
          // Marker that this came from cron — the hash makes it grep-able
          // without putting a literal "cron" string in the audit row.
          sourceHash: sha256('cron/retention').slice(0, 8),
        },
        ip: null,
        userAgent: 'cron/retention',
      });
    }
    return { found: ids.length, anonymized };
  });

  logger.info('retention_completed');
}

function yearsAgo(n: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d;
}
