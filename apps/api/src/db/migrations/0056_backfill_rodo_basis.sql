-- 2026-07-14 — backfill RODO (application_form) basis for the pre-existing base.
--
-- Business decision: a candidate/client in the CRM cannot exist without a
-- processing basis, so RODO must read "green" for everyone. This one-time
-- backfill records an active application_form consent (source 'backfill') for
-- every non-anonymized candidate that has an email or phone and does not
-- already hold one. Keyed on email AND/OR phone so phone-only rows count too.
--
-- Idempotent: the NOT EXISTS guard means a re-run inserts nothing (every
-- candidate already has a row after the first apply). New candidates created
-- after this get their basis at creation time (source 'intake') in code.

INSERT INTO "consents" (candidate_email, candidate_phone, consent_type, version, source)
SELECT
  c.email,
  NULLIF(trim(c.phone), ''),
  'application_form',
  'polityka-prywatnosci-2026',
  'backfill'
FROM "candidates" c
WHERE c.anonymized_at IS NULL
  AND (c.email IS NOT NULL OR NULLIF(trim(c.phone), '') IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM "consents" k
    WHERE k.consent_type = 'application_form'
      AND k.withdrawn_at IS NULL
      AND (
        (c.email IS NOT NULL AND k.candidate_email = c.email)
        OR (NULLIF(trim(c.phone), '') IS NOT NULL AND k.candidate_phone = trim(c.phone))
      )
  );
