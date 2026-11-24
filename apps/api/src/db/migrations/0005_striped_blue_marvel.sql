CREATE TABLE IF NOT EXISTS "accommodations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"room" text,
	"capacity" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "placements" ADD COLUMN "accommodation_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accommodations_address_idx" ON "accommodations" USING btree ("address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accommodations_is_active_idx" ON "accommodations" USING btree ("is_active");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "placements" ADD CONSTRAINT "placements_accommodation_id_accommodations_id_fk" FOREIGN KEY ("accommodation_id") REFERENCES "public"."accommodations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "placements_accommodation_id_idx" ON "placements" USING btree ("accommodation_id");