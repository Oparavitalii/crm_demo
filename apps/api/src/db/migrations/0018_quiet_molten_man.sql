ALTER TABLE "candidates" ADD COLUMN "documents_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "arrival_status" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "arrived_at" timestamp with time zone;--> statement-breakpoint
-- documents_submitted_at: anyone past the documents_submitted stage gets the timestamp.
UPDATE "candidates"
  SET "documents_submitted_at" = "updated_at"
  WHERE "status" IN ('documents_submitted', 'arrived', 'no_show', 'our_housing', 'own_housing', 'employed', 're_employed', 'dismissed', 'blacklist')
  AND "documents_submitted_at" IS NULL;
--> statement-breakpoint
-- arrival_status: arrived for anyone past arrived stage, no_show for the dead-end status.
UPDATE "candidates" SET "arrival_status" = 'arrived' WHERE "status" IN ('arrived', 'our_housing', 'own_housing', 'employed', 're_employed', 'dismissed');
--> statement-breakpoint
UPDATE "candidates" SET "arrival_status" = 'no_show' WHERE "status" = 'no_show';
--> statement-breakpoint
-- arrived_at: synthesize from updated_at for backfilled arrived rows.
UPDATE "candidates" SET "arrived_at" = "updated_at" WHERE "arrival_status" = 'arrived' AND "arrived_at" IS NULL;
