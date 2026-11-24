-- FAZA 28 (2026-05-30): backfill coordinator_id for legacy clients (kind='client'
-- with coordinator_id IS NULL) using round-robin across all active coordinators.
-- This is paired with a service-level change to strict "own-only" RBAC scope
-- for the coordinator role — without backfill, all legacy clients would
-- disappear from every coordinator's view.
--
-- Guarded so the migration is a no-op when there are zero active coordinators
-- (avoids `% 0` / `% NULL` errors and lets fresh databases / test schemas
-- apply the migration cleanly).
DO $$
DECLARE
  coord_count INT;
BEGIN
  SELECT COUNT(*) INTO coord_count
  FROM users
  WHERE role = 'coordinator' AND is_active = true;

  IF coord_count = 0 THEN
    RAISE NOTICE 'No active coordinators — skipping FAZA 28 backfill.';
    RETURN;
  END IF;

  WITH coords AS (
    SELECT id, (row_number() OVER (ORDER BY id) - 1) AS idx,
           COUNT(*) OVER () AS total
    FROM users
    WHERE role = 'coordinator' AND is_active = true
  ),
  ranked AS (
    SELECT c.id,
           (row_number() OVER (ORDER BY c.created_at) - 1)
             -- coords.total is identical on every row (COUNT(*) OVER ()); LIMIT 1 just picks one to satisfy the subquery scalar requirement.
             % (SELECT total FROM coords LIMIT 1) AS bucket
    FROM candidates c
    WHERE c.kind = 'client'
      AND c.coordinator_id IS NULL
      AND c.anonymized_at IS NULL
  )
  UPDATE candidates
  SET coordinator_id = (SELECT id FROM coords WHERE idx = ranked.bucket)
  FROM ranked
  WHERE candidates.id = ranked.id;
END $$;
