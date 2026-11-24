-- 2026-06-10 Block 7 (Звірка / Виплати) — three new candidate columns that
-- finalize the migration off the Excel «Звірка кандидатів» workbook.
-- All three are plain text + driven by a `status_lookups` dropdown so admins
-- can rename / extend the codes from the UI without a schema migration. Same
-- pattern as `position` and `legal_status` from migration 0033.
--
-- - `work_outcome`   — chosen by the coordinator at month-end reconciliation
--                      ('worked' / 'working') — null means "not yet decided".
-- - `payout_status`  — the «Підсумок» badge on the candidate row
--                      ('payable' / 'internal_recruitment' / 'term_not_served').
-- - `payment_status` — the «Виплачено» badge ('paid' / 'invoice_pending').
--
-- IF NOT EXISTS / ON CONFLICT guards make the migration safe to re-apply.

ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "work_outcome"   text;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "payout_status"  text;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "payment_status" text;

-- Seed lookup options. is_system=false so admins can soft-delete or extend
-- from /admin/statuses. Codes match the Ukrainian/Polish badges from the
-- legacy workbook so the existing Excel-style mental model is preserved.
INSERT INTO "status_lookups" ("type", "code", "label_pl", "label_ua", "sort_order", "is_system") VALUES
  ('work_outcome',   'worked',               'Odpracował',            'Відпрацював',                 10, false),
  ('work_outcome',   'working',              'Pracuje',               'Відпрацьовує',                20, false),

  ('payout_status',  'payable',              'Do wypłaty',            'На виплату',                  10, false),
  ('payout_status',  'internal_recruitment', 'Rekrutacja wewnętrzna', 'Внутрішня рекрутація',        20, false),
  ('payout_status',  'term_not_served',      'Nie przepracował',      'Не відпрацював термін',       30, false),

  ('payment_status', 'paid',                 'Wypłacone',             'Виплачено',                   10, false),
  ('payment_status', 'invoice_pending',      'Wypłata po fakturze',   'Виплата по фактурі',          20, false)
ON CONFLICT ("type", "code") WHERE "deleted_at" IS NULL DO NOTHING;
