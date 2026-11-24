import { describe, it, expect } from 'vitest';
import {
  HIDDEN_FIELDS_BY_ROLE,
  hiddenFieldsForRole,
} from '../features/candidates/roleFieldVisibility';

// 2026-07-08 client matrix: admin sees everything; staff recruiters lose the
// accounting trio; coordinators additionally lose source, payout status and
// the documents date. Field keys here must match column accessors in
// columns.tsx and Candidate schema keys — a typo would silently hide nothing.
describe('roleFieldVisibility', () => {
  it('admin and readonly see every field', () => {
    expect(HIDDEN_FIELDS_BY_ROLE.admin).toEqual([]);
    expect(HIDDEN_FIELDS_BY_ROLE.readonly).toEqual([]);
    expect(hiddenFieldsForRole('admin').size).toBe(0);
    expect(hiddenFieldsForRole('readonly').size).toBe(0);
  });

  it('recruiter loses exactly the accounting trio', () => {
    expect(hiddenFieldsForRole('recruiter')).toEqual(
      new Set(['workOutcome', 'reconciliationPeriod', 'paymentStatus']),
    );
  });

  it('coordinator loses the recruiter set plus source, payoutStatus, documentsSubmittedAt', () => {
    expect(hiddenFieldsForRole('coordinator')).toEqual(
      new Set([
        'workOutcome',
        'reconciliationPeriod',
        'paymentStatus',
        'source',
        'payoutStatus',
        'documentsSubmittedAt',
      ]),
    );
  });

  it('coordinator set is a superset of the recruiter set', () => {
    const coordinator = hiddenFieldsForRole('coordinator');
    for (const key of hiddenFieldsForRole('recruiter')) {
      expect(coordinator.has(key)).toBe(true);
    }
  });

  it('unknown role (auth hydrating) falls back to the most restrictive set', () => {
    expect(hiddenFieldsForRole(undefined)).toEqual(hiddenFieldsForRole('coordinator'));
  });
});
