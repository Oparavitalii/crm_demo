import { and, count, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { consents } from '../db/tables/consents';
import { candidates } from '../db/tables/candidates';
import type { ConsentHistoryItem, ListConsentHistoryQuery } from '@crm/shared';

// Best-effort candidate name for a consent row — matched by email or phone.
// Correlated subquery (small N + indexed) to avoid fan-out from a JOIN when an
// email/phone happens to map to more than one candidate.
const candidateNameExpr = sql<string | null>`(
  SELECT c.name FROM ${candidates} c
  WHERE (${consents.candidateEmail} IS NOT NULL AND c.email = ${consents.candidateEmail})
     OR (${consents.candidatePhone} IS NOT NULL AND trim(c.phone) = ${consents.candidatePhone})
  ORDER BY c.created_at DESC
  LIMIT 1
)`;

export async function list(
  query: ListConsentHistoryQuery,
): Promise<{ items: ConsentHistoryItem[]; total: number }> {
  const where: SQL[] = [];
  if (query.consentType) where.push(eq(consents.consentType, query.consentType));
  if (query.status === 'active') where.push(isNull(consents.withdrawnAt));
  else if (query.status === 'withdrawn') where.push(isNotNull(consents.withdrawnAt));
  if (query.q) {
    const term = `%${query.q.replace(/[\\%_]/g, '\\$&')}%`;
    where.push(
      or(ilike(consents.candidateEmail, term), ilike(consents.candidatePhone, term))!,
    );
  }

  const condition = where.length ? and(...where) : undefined;
  const offset = (query.page - 1) * query.pageSize;

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: consents.id,
        candidateName: candidateNameExpr,
        candidateEmail: consents.candidateEmail,
        candidatePhone: consents.candidatePhone,
        consentType: consents.consentType,
        source: consents.source,
        acceptedAt: consents.acceptedAt,
        withdrawnAt: consents.withdrawnAt,
        ip: consents.ip,
      })
      .from(consents)
      .where(condition)
      .orderBy(desc(consents.acceptedAt))
      .limit(query.pageSize)
      .offset(offset),
    db.select({ c: count() }).from(consents).where(condition).then((r) => r[0]),
  ]);

  const items: ConsentHistoryItem[] = rows.map((r) => ({
    id: r.id,
    candidateName: r.candidateName ?? null,
    candidateEmail: r.candidateEmail,
    candidatePhone: r.candidatePhone,
    consentType: r.consentType,
    source: r.source,
    acceptedAt: r.acceptedAt.toISOString(),
    withdrawnAt: r.withdrawnAt ? r.withdrawnAt.toISOString() : null,
    ip: r.ip,
  }));

  return { items, total: totalRow?.c ?? 0 };
}
