-- Fix candidate_status lookup rows to match the actual 8-status enum used by
-- the app. Migration 0027 seeded 11 values matching an earlier FAZA 19 plan;
-- the live enum was already trimmed to: new, in_progress, documents_submitted,
-- cancelled, employed, re_employed, dismissed, blacklist.
--
-- Remove the 4 obsolete codes (arrived, no_show, our_housing, own_housing) —
-- hard-delete since they were only seeded yesterday and reference nothing
-- (the partial unique index on (type, code) WHERE deleted_at IS NULL would
-- block re-insert otherwise).

DELETE FROM "status_lookups"
WHERE "type" = 'candidate_status'
  AND "code" IN ('arrived', 'no_show', 'our_housing', 'own_housing');

-- Insert the missing 'cancelled' status, slot between documents_submitted (30)
-- and employed (80).
INSERT INTO "status_lookups" ("type", "code", "label_pl", "label_ua", "sort_order", "is_system") VALUES
  ('candidate_status', 'cancelled', 'Anulowany', 'Відмінений', 35, true)
ON CONFLICT ("type", "code") WHERE "deleted_at" IS NULL DO NOTHING;
