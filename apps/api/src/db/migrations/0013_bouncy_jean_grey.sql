ALTER TABLE "candidates" ALTER COLUMN "source" SET DATA TYPE text USING source::text;--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "source" SET DATA TYPE text USING source::text;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."lead_source";
