import type { UserRole } from '@opushr/shared';

// 2026-07-08 client decision — reconciliation/accounting fields are scoped by
// role EVERYWHERE in the UI (list columns + «Колонки» menu, filters, mobile
// cards, detail page, edit form). Admin keeps the full picture; staff
// recruiters lose the accounting trio; coordinators additionally lose source,
// payout status and the documents date. `readonly` was not part of the client
// matrix — left with full visibility like admin.
//
// UI-level hiding only: the API still returns these fields to every
// authenticated role. Server-side redaction is a separate backend task.
const RECRUITER_HIDDEN = ['workOutcome', 'reconciliationPeriod', 'paymentStatus'] as const;
const COORDINATOR_HIDDEN = [
  ...RECRUITER_HIDDEN,
  'source',
  'payoutStatus',
  'documentsSubmittedAt',
] as const;

export const HIDDEN_FIELDS_BY_ROLE: Record<UserRole, readonly string[]> = {
  admin: [],
  readonly: [],
  recruiter: RECRUITER_HIDDEN,
  coordinator: COORDINATOR_HIDDEN,
};

// Undefined role (auth store still hydrating) gets the most restrictive set so
// nothing flashes into view before the real role is known.
export function hiddenFieldsForRole(role: UserRole | undefined): ReadonlySet<string> {
  return new Set(role ? HIDDEN_FIELDS_BY_ROLE[role] : COORDINATOR_HIDDEN);
}
