-- F16: tasks / reminders module. Per-candidate tasks for recruiters and
-- the manager. Types: 'contact' | 'email' | 'other' (text column for
-- forward compatibility — UI enforces enum). Cascade on candidate delete:
-- tasks have no independent identity. Assignee/creator set null on user
-- deactivation so the task survives and can be reassigned.
CREATE TABLE IF NOT EXISTS "tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "candidate_id" uuid NOT NULL,
  "assignee_id" uuid,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "due_at" timestamp with time zone,
  "done_at" timestamp with time zone,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_candidate_id_candidates_id_fk"
    FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk"
    FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_users_id_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "tasks_candidate_id_idx" ON "tasks" USING btree ("candidate_id");
CREATE INDEX IF NOT EXISTS "tasks_assignee_id_idx" ON "tasks" USING btree ("assignee_id");
-- Partial index — most queries are "what's due for me / for this candidate"
-- filtered to open tasks. Skipping done rows keeps the index small.
CREATE INDEX IF NOT EXISTS "tasks_due_at_idx" ON "tasks" USING btree ("due_at") WHERE "done_at" IS NULL;
