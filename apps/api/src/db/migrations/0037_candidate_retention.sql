-- 2026-06-10 Block 7 follow-up — «Утримання кандидата» (retention):
-- categorical record of how long the client (post-hire) stayed on the job.
-- Same soft-enum + status_lookups pattern as work_outcome / payout_status.
-- Coordinator picks the bucket at month-end reconciliation.
--
-- Codes mirror the legacy Excel column verbatim so existing recruiter
-- intuition transfers:
--   under_month        — Меньше місяця
--   month_plus         — 1 місяць плюс
--   two_months_plus    — 2 місяця плюс
--   three_months_plus  — 3 місяця плюс
--   six_months_plus    — 6 місяців плюс
--   eleven_months_plus — 11 місяців плюс
--   off_target         — нецільовий кандидат (sourcing mismatch — won't stay)

ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "retention" text;

INSERT INTO "status_lookups" ("type", "code", "label_pl", "label_ua", "sort_order", "is_system") VALUES
  ('retention', 'under_month',        'Mniej niż miesiąc',  'Меньше місяця',       10, false),
  ('retention', 'month_plus',         '1 miesiąc plus',     '1 місяць плюс',       20, false),
  ('retention', 'two_months_plus',    '2 miesiące plus',    '2 місяця плюс',       30, false),
  ('retention', 'three_months_plus',  '3 miesiące plus',    '3 місяця плюс',       40, false),
  ('retention', 'six_months_plus',    '6 miesięcy plus',    '6 місяців плюс',      50, false),
  ('retention', 'eleven_months_plus', '11 miesięcy plus',   '11 місяців плюс',     60, false),
  ('retention', 'off_target',         'Niedocelowy kandydat','Нецільовий кандидат', 99, false)
ON CONFLICT ("type", "code") WHERE "deleted_at" IS NULL DO NOTHING;
