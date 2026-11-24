-- FAZA 19 (2026-05-29): candidate pipeline rebuild — new statuses, kind flag,
-- coordinator assignment, lifecycle timestamps.
--
-- Critical: the old enum has values awaiting_invite/housed/working that are NOT
-- in the new enum. We must convert the column to text, UPDATE old values to new
-- ones, then drop+recreate the enum, then cast back. Order matters.

CREATE TYPE "public"."candidate_kind" AS ENUM('candidate', 'client');--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "kind" "candidate_kind" DEFAULT 'candidate' NOT NULL;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "employed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "re_employed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "blacklisted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "coordinator_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "candidates" ADD CONSTRAINT "candidates_coordinator_id_users_id_fk" FOREIGN KEY ("coordinator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidates_kind_idx" ON "candidates" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidates_coordinator_id_idx" ON "candidates" USING btree ("coordinator_id");--> statement-breakpoint
-- Convert status to text so we can rewrite old values without enum constraint blocking us.
ALTER TABLE "public"."candidates" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "public"."candidates" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
-- Map old values to new (per Decision 2):
--   awaiting_invite -> documents_submitted
--   housed          -> our_housing
--   working         -> employed
UPDATE "candidates" SET "status" = 'documents_submitted' WHERE "status" = 'awaiting_invite';--> statement-breakpoint
UPDATE "candidates" SET "status" = 'our_housing' WHERE "status" = 'housed';--> statement-breakpoint
UPDATE "candidates" SET "status" = 'employed' WHERE "status" = 'working';--> statement-breakpoint
-- Backfill kind='client' + employed_at for already-promoted candidates.
-- We treat employed + dismissed as past clients (dismissal implies prior employment).
UPDATE "candidates"
  SET "kind" = 'client',
      "employed_at" = COALESCE("work_start_date", "updated_at")
  WHERE "status" IN ('employed', 'dismissed');--> statement-breakpoint
-- Drop and recreate the enum with the new value set, then cast column back.
DROP TYPE "public"."candidate_status";--> statement-breakpoint
CREATE TYPE "public"."candidate_status" AS ENUM('new', 'in_progress', 'documents_submitted', 'arrived', 'no_show', 'our_housing', 'own_housing', 'employed', 're_employed', 'dismissed', 'blacklist');--> statement-breakpoint
ALTER TABLE "public"."candidates" ALTER COLUMN "status" SET DATA TYPE "public"."candidate_status" USING "status"::"public"."candidate_status";--> statement-breakpoint
ALTER TABLE "public"."candidates" ALTER COLUMN "status" SET DEFAULT 'new'::"public"."candidate_status";
