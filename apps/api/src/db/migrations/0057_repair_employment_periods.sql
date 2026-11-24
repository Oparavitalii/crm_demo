-- 2026-08-12 — one-time repair: reconcile employment_periods with candidate
-- statuses (client report 12.08: recruiters showed 100% retention because
-- annulled / bulk-dismissed candidates kept an OPEN episode forever).
--
-- Root cause, fixed in code the same day (candidates.service.ts):
--   • cancelCandidate never closed the open episode;
--   • the generic PATCH (bulk status switcher, edit-form date auto-bump)
--     neither closed episodes on dismissed/cancelled/blacklist nor created
--     them on employed/re_employed.
-- This migration repairs the rows those paths already corrupted.
--
-- Idempotent: part 1 touches only still-open episodes of terminal-status
-- candidates (none remain after the first apply); part 2 has a NOT EXISTS
-- guard on an open episode.

-- Part 1 — close open episodes of candidates in a terminal status.
-- Close date preference: the business date on the card (work_end_date), else
-- the audit-log moment the status actually flipped (bulk PATCH writes
-- update_candidate with new_value.status; cancel writes cancel_candidate),
-- else updated_at as a last resort. Clamped to employed_at so an annulment
-- recorded before the start date yields a 0-day episode, not a negative one.
UPDATE employment_periods ep
SET
  dismissed_at = GREATEST(
    ep.employed_at,
    COALESCE(c.work_end_date, al.status_changed_at, c.updated_at)
  ),
  dismissed_reason = CASE
    WHEN c.status = 'dismissed' THEN COALESCE(c.work_end_reason, c.reason_note, 'other')
    ELSE c.status::text
  END
FROM candidates c
  LEFT JOIN LATERAL (
    SELECT max(a.created_at) AS status_changed_at
    FROM audit_log a
    WHERE a.entity_type = 'candidate'
      AND a.entity_id = c.id::text
      AND (
        (a.action = 'update_candidate' AND a.new_value ->> 'status' = c.status::text)
        OR (a.action = 'cancel_candidate' AND c.status = 'cancelled')
      )
  ) al ON true
WHERE ep.candidate_id = c.id
  AND ep.dismissed_at IS NULL
  AND c.anonymized_at IS NULL
  AND c.status IN ('dismissed', 'cancelled', 'blacklist');
--> statement-breakpoint

-- Part 2 — create the missing episode for candidates who ARE working
-- (employed/re_employed) but have no open episode: legacy imports and manual
-- form edits set work_start_date without ever inserting a period, so these
-- people were invisible to retention analytics. created_by stays NULL —
-- marks the row as system-created, no human actor to attribute.
INSERT INTO employment_periods (candidate_id, employed_at, housing_type, project_id, coordinator_id)
SELECT
  c.id,
  c.work_start_date,
  c.housing_type,
  c.project_id,
  c.coordinator_id
FROM candidates c
WHERE c.status IN ('employed', 're_employed')
  AND c.anonymized_at IS NULL
  AND c.work_start_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM employment_periods ep
    WHERE ep.candidate_id = c.id
      AND ep.dismissed_at IS NULL
  );
