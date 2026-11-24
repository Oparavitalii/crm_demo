import { pgEnum } from 'drizzle-orm/pg-core';
import { CANDIDATE_STATUSES } from '@opushr/shared';

// HousingType is not a pgEnum in the DB (the column is plain text) — it lives
// as a Zod-validated string set. Re-export from shared so every layer reads the
// same source of truth.
export {
  HOUSING_TYPES,
  type HousingType,
} from '@opushr/shared';

export const userRole = pgEnum('user_role', [
  'admin',
  'recruiter',
  'coordinator',
  'readonly',
]);

// candidate_status pgEnum is derived from @opushr/shared so the Zod schema and
// the DB enum can never drift. Order MUST match the most recent migration
// (0024) — Drizzle uses position for ALTER TYPE ADD VALUE codegen.
export const candidateStatus = pgEnum('candidate_status', CANDIDATE_STATUSES);

// FAZA 19: `kind` flips from 'candidate' to 'client' automatically when status
// transitions to 'employed' (auto-promotion). Used by /clients view filter.
export const candidateKind = pgEnum('candidate_kind', ['candidate', 'client']);

// `lead_source` was a pgEnum until 2026-05-21 — converted to plain text on
// both leads.source and candidates.source so admins can add custom sources
// (olx, instagram, referral, ...) directly from the create-lead form.
// CANDIDATE_SOURCES in shared still exports the original 5 as suggestions
// for autocomplete dropdowns.

export const messageChannel = pgEnum('message_channel', ['email', 'sms']);

export const messageDirection = pgEnum('message_direction', [
  'outbound',
  'inbound',
]);

export const messageStatus = pgEnum('message_status', [
  'queued',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'failed',
]);

export const employerInquiryStatus = pgEnum('employer_inquiry_status', [
  'new',
  'contacted',
  'accepted',
  'rejected',
  'archived',
]);

export const employerInquirySource = pgEnum('employer_inquiry_source', [
  'web',
  'manual',
]);

export const documentCategory = pgEnum('document_category', [
  'regulamin',
  'rodo',
  'procedura',
  'polityka',
  'inne',
]);
