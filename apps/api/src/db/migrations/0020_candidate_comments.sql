-- FAZA 27 Task 1: per-candidate threaded comments.
-- Separate table from `candidates.notes` (which stays as a single-summary blurb)
-- so recruiters can append discussion entries over time. Cascade delete with
-- the candidate; author FK is set null so a user removal doesn't wipe history.
CREATE TABLE IF NOT EXISTS "candidate_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "candidate_id" uuid NOT NULL,
  "author_id" uuid,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "candidate_comments_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id")
    REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "candidate_comments_author_id_users_id_fk" FOREIGN KEY ("author_id")
    REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "candidate_comments_candidate_id_idx"
  ON "candidate_comments" USING btree ("candidate_id");
CREATE INDEX IF NOT EXISTS "candidate_comments_created_at_idx"
  ON "candidate_comments" USING btree ("created_at");
