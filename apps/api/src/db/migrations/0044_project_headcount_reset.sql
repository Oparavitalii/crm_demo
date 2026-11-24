-- applied via release_command on Fly per CLAUDE.md
--
-- Adds the staffing baseline column `headcount_reset_at` to projects. Used by
-- the foundCount query to count only candidates updated AFTER this timestamp,
-- so resetting a project's headcount/start_date restarts the progress bar
-- without losing historical placements. Default `now()` is idempotent: on
-- existing rows the column populates to the current moment, which means their
-- baseline becomes "right now" — safe default per spec. Bumped by the project
-- update endpoint when headcountNeeded or startDate changes.

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "headcount_reset_at" timestamp with time zone NOT NULL DEFAULT now();
