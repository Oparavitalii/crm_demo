// Programmatic Drizzle migrator. Invoked by `fly.toml` release_command on
// every deploy — runs before the new app/cron machines start. Idempotent:
// drizzle tracks applied migrations in __drizzle_migrations table.
//
// We use drizzle-orm's migrate() (production dep) instead of `drizzle-kit migrate`
// (devDep, not in production image).

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../env';
import { logger } from '../lib/logger';

async function main(): Promise<void> {
  // Use DIRECT URL (not the pooled one) — DDL statements require a stable
  // connection that Neon's pgbouncer pool won't reliably hand out.
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL_DIRECT,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

  const db = drizzle(pool);

  // Resolve migrations folder RELATIVE TO THIS SCRIPT so it works regardless
  // of where `tsx` was invoked from (cwd=apps/api locally, cwd=/app on Fly).
  // This file is at src/scripts/migrate.ts → migrations at ../db/migrations.
  const migrationsFolder = fileURLToPath(new URL('../db/migrations', import.meta.url));

  const startedAt = Date.now();
  try {
    await migrate(db, { migrationsFolder });
    logger.info(
      { durationMs: Date.now() - startedAt, folder: migrationsFolder },
      'migrations_applied',
    );
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // Print to stderr so Fly logs surface it on deploy failure.
    console.error('Migration failed:', err);
    process.exit(1);
  });
