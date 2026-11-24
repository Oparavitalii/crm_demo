-- FAZA 19.5 (2026-05-29): denormalized housing_type + dismissed_at on candidates.
-- These fields capture the candidate's housing state (our/own) and dismissal
-- timestamp so that the info survives auto-promotion to `employed` (housing)
-- and is fast to display in lists without joining `dismissals`.

ALTER TABLE "candidates" ADD COLUMN "housing_type" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
-- Backfill: derive housing_type from current status for live rows.
UPDATE "candidates" SET "housing_type" = 'our' WHERE "status" = 'our_housing';--> statement-breakpoint
UPDATE "candidates" SET "housing_type" = 'own' WHERE "status" = 'own_housing';--> statement-breakpoint
-- Backfill: take the most recent dismissed_at from dismissals per candidate.
UPDATE "candidates" c SET "dismissed_at" = d.max_dismissed_at
FROM (SELECT candidate_id, MAX(dismissed_at) AS max_dismissed_at FROM dismissals GROUP BY candidate_id) d
WHERE c.id = d.candidate_id;
