import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { env } from '../env';
import { logger } from '../lib/logger';
import { seedDemo, type DemoSeedSummary } from './seed';

// Nightly reset of the public demo: drop everything, re-apply every migration,
// seed again. Rebuilding from the migration chain (rather than truncating)
// also restores lookup lists and documents that visitors edited or deleted,
// and proves on every run that the schema still builds from nothing.
//
// Refuses to run unless DEMO_MODE=true — this is the only code path in the
// repository that drops the schema.
export async function resetDemo(): Promise<DemoSeedSummary> {
  if (!env.DEMO_MODE) {
    throw new Error('resetDemo refused: DEMO_MODE is not true');
  }
  const startedAt = Date.now();
  // DIRECT URL: DDL needs a stable session, not a transaction-mode pooler.
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL_DIRECT, max: 1 });
  try {
    await pool.query(`
      DROP SCHEMA IF EXISTS drizzle CASCADE;
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
    `);
    // Same depth as scripts/migrate.ts, so the relative path also resolves in
    // the compiled bundles (dist/cron/scheduler.js, dist/scripts/demo-data.js).
    const migrationsFolder = fileURLToPath(new URL('../db/migrations', import.meta.url));
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
  const summary = await seedDemo();
  logger.info({ ...summary, durationMs: Date.now() - startedAt }, 'demo_reset_completed');
  return summary;
}
