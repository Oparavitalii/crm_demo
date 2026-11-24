-- 2026-06-01 status-model rework.
--
-- Active 8-value lifecycle: new, in_progress, documents_submitted, cancelled,
-- employed, re_employed, dismissed, blacklist.
--
-- Drops legacy values: arrived, no_show, our_housing, own_housing.
-- New value: cancelled.
--
-- Data migrations:
--   arrived      → documents_submitted     (arrival flag already on arrival_status column)
--   no_show      → cancelled (+ cancel_reason_code='no_show_lost_contact')
--   our_housing  → employed (+ housing_type='our' if null)
--   own_housing  → employed (+ housing_type='own' if null)
--   kind='candidate' with status in (employed, re_employed) → kind='client'
--   Seed employment_periods from existing employed_at cache.

ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "cancel_reason_code" varchar(40);--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "cancel_reason_note" varchar(200);--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "commute_type" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "expected_departure_date" timestamp with time zone;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "candidates_expected_departure_date_idx"
  ON "candidates" USING btree ("expected_departure_date")
  WHERE "expected_departure_date" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "candidates_cancel_reason_code_idx"
  ON "candidates" USING btree ("cancel_reason_code")
  WHERE "cancel_reason_code" IS NOT NULL;--> statement-breakpoint

-- Convert status to text so we can rewrite old values and recreate the enum
-- without the type constraint blocking us. Same pattern as migration 0016.
ALTER TABLE "candidates" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint

-- Map old values to new.
UPDATE "candidates" SET "status" = 'documents_submitted' WHERE "status" = 'arrived';--> statement-breakpoint

UPDATE "candidates"
   SET "status" = 'cancelled',
       "cancel_reason_code" = 'no_show_lost_contact',
       "cancelled_at" = COALESCE("updated_at", now())
 WHERE "status" = 'no_show';--> statement-breakpoint

UPDATE "candidates"
   SET "status" = 'employed',
       "housing_type" = COALESCE("housing_type", 'our'),
       "employed_at" = COALESCE("employed_at", "updated_at", now())
 WHERE "status" = 'our_housing';--> statement-breakpoint

UPDATE "candidates"
   SET "status" = 'employed',
       "housing_type" = COALESCE("housing_type", 'own'),
       "employed_at" = COALESCE("employed_at", "updated_at", now())
 WHERE "status" = 'own_housing';--> statement-breakpoint

-- Promote anyone now employed but still kind='candidate'.
UPDATE "candidates" SET "kind" = 'client'
  WHERE "kind" = 'candidate' AND "status" IN ('employed', 're_employed');--> statement-breakpoint

-- Drop old enum, recreate with the 8-value set, cast column back.
DROP TYPE "public"."candidate_status";--> statement-breakpoint
CREATE TYPE "public"."candidate_status" AS ENUM('new', 'in_progress', 'documents_submitted', 'cancelled', 'employed', 're_employed', 'dismissed', 'blacklist');--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "status" SET DATA TYPE "public"."candidate_status" USING "status"::text::"public"."candidate_status";--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "status" SET DEFAULT 'new';--> statement-breakpoint

-- employment_periods table.
CREATE TABLE IF NOT EXISTS "employment_periods" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "candidate_id"      uuid NOT NULL,
  "employed_at"       timestamp with time zone NOT NULL,
  "dismissed_at"      timestamp with time zone,
  "dismissed_reason"  text,
  "housing_type"      text,
  "commute_type"      text,
  "project_id"        uuid,
  "coordinator_id"    uuid,
  "created_at"        timestamp with time zone DEFAULT now() NOT NULL,
  "created_by"        uuid
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_candidate_id_candidates_id_fk"
    FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_coordinator_id_users_id_fk"
    FOREIGN KEY ("coordinator_id") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "employment_periods_candidate_id_idx"
  ON "employment_periods" USING btree ("candidate_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "employment_periods_employed_at_idx"
  ON "employment_periods" USING btree ("employed_at");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "employment_periods_open_per_candidate_idx"
  ON "employment_periods" USING btree ("candidate_id")
  WHERE "dismissed_at" IS NULL;--> statement-breakpoint

-- Seed employment_periods from the denormalized cache. Closed periods get
-- their dismissed_at + reason from the candidate row directly.
INSERT INTO "employment_periods" (
  "id", "candidate_id", "employed_at", "dismissed_at", "dismissed_reason",
  "housing_type", "commute_type", "project_id", "coordinator_id",
  "created_at", "created_by"
)
SELECT
  gen_random_uuid(),
  c."id",
  c."employed_at",
  c."dismissed_at",
  c."work_end_reason",
  c."housing_type",
  c."commute_type",
  c."project_id",
  c."coordinator_id",
  COALESCE(c."employed_at", c."created_at"),
  NULL
FROM "candidates" c
WHERE c."employed_at" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "employment_periods" ep WHERE ep."candidate_id" = c."id");
