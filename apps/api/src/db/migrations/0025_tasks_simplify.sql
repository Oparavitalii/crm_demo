-- 2026-06-02 tasks simplification.
--
-- Adds: description (free-text), status (new|in_work|completed|cancelled).
-- Makes candidate_id nullable so personal/admin tasks can exist without a
-- candidate context (sidebar Tasks panel use case).
--
-- Backfills:
--   status='completed' for rows with done_at IS NOT NULL
--   status='new'       for everything else

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'new';--> statement-breakpoint

-- Drop NOT NULL on candidate_id. Existing rows stay valid (all currently have
-- a candidate); new "standalone" tasks created from the tasks panel may omit it.
ALTER TABLE "tasks" ALTER COLUMN "candidate_id" DROP NOT NULL;--> statement-breakpoint

-- Backfill status from done_at presence (existing two-state model).
UPDATE "tasks" SET "status" = 'completed' WHERE "done_at" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tasks_status_idx" ON "tasks" USING btree ("status");
