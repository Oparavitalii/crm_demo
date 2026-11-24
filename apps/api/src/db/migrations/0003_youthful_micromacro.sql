ALTER TABLE "candidates" ADD COLUMN "work_start_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "work_end_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "work_end_reason" text;