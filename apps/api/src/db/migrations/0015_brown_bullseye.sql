ALTER TABLE "candidates" ADD COLUMN "no_show_reason" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "reason_note" text;--> statement-breakpoint
ALTER TABLE "dismissals" ADD COLUMN "reason_code" text;--> statement-breakpoint
-- FAZA 24a: rename source value 'manual' -> 'unknown' so recruiters consciously
-- pick a source when adding candidates/leads. Old value 'manual' implied
-- "I didn't pick", new value 'unknown' is more accurate in the analytics tab.
UPDATE "candidates" SET "source" = 'unknown' WHERE "source" = 'manual';--> statement-breakpoint
UPDATE "leads" SET "source" = 'unknown' WHERE "source" = 'manual';