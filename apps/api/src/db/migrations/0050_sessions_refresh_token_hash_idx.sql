-- 2026-07-02 — Index the /auth/refresh hot path.
--
-- sessions are resolved by refresh_token_hash on every silent refresh (each
-- tab, every ~15 min per user). Until now the table was tiny (one row per
-- active session) so a seq scan was free; rotation tombstones (0049) grow it
-- to ~1-2k rows between retention sweeps, so give the lookup an index.
--
-- Idempotent: IF NOT EXISTS; re-running is a no-op.

CREATE INDEX IF NOT EXISTS "sessions_refresh_token_hash_idx"
  ON "sessions" ("refresh_token_hash");
