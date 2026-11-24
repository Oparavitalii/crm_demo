-- 2026-06-02 add freelancer flag to users.
--
-- Distinguishes in-house staff ("own") from external freelance recruiters in
-- the admin user list and downstream retention analytics. Defaults to false so
-- every existing user stays in the "own" bucket — operator can flip the flag
-- per user as needed.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_freelancer" boolean NOT NULL DEFAULT false;
