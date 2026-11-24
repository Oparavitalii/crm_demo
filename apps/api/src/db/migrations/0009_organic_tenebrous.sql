CREATE TABLE IF NOT EXISTS "duplicate_ignores" (
	"entity_type" text NOT NULL,
	"id_a" uuid NOT NULL,
	"id_b" uuid NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_ignores_entity_type_id_a_id_b_pk" PRIMARY KEY("entity_type","id_a","id_b")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "duplicate_ignores" ADD CONSTRAINT "duplicate_ignores_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "duplicate_ignores_type_idx" ON "duplicate_ignores" USING btree ("entity_type");