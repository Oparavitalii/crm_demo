-- 2026-07-02 — Session rotation tombstones (fix "logged out next morning").
--
-- /auth/refresh used to DELETE the old session row on every rotation. Two
-- consequences broke real users:
--   1. Multi-tab race: tabs restored together each send /auth/refresh with
--      the same cookie; the first rotates, the rest present a token whose
--      row is gone — the old "reuse detection" then wiped ALL of the user's
--      sessions (every device logged out).
--   2. requireAuth checks that the session row behind an access token still
--      exists, so every rotation instantly invalidated the other tabs'
--      access tokens.
--
-- New model: rotation keeps the old row as a tombstone — `rotated_at` is
-- stamped and `replaced_by_id` points at the successor session. Within a
-- 60s grace window a rotated token still yields an access token bound to
-- the replacement; outside it, only the affected lineage is revoked. The
-- retention cron sweeps tombstones older than 24h.
--
-- Idempotent: IF NOT EXISTS everywhere; re-running is a no-op.

ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "rotated_at" timestamp with time zone;

ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "replaced_by_id" uuid;

DO $$ BEGIN
  ALTER TABLE "sessions"
    ADD CONSTRAINT "sessions_replaced_by_id_sessions_id_fk"
    FOREIGN KEY ("replaced_by_id") REFERENCES "sessions"("id") ON DELETE set null;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "sessions_rotated_at_idx" ON "sessions" ("rotated_at");
