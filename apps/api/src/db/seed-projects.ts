/**
 * Seeds the demo project list (fictional client sites). Idempotent — uses the
 * `projects_name_idx` unique index via `onConflictDoNothing`, so re-running
 * is a no-op for already-present names. Admins can still add custom projects
 * via the UI (ProjectSelect "+ new" modal).
 *
 * Run: npm run db:seed-projects -w @crm/api
 */
import { db } from './client';
import { projects } from './tables/projects';
import { logger } from '../lib/logger';

const SEED_NAMES = [
  'Northwind Logistics Wrocław',
  'Contoso Foods Poznań',
  'Fabrikam Packaging Legnica',
  'Tailspin Parcel Hub Łódź',
  'Adventure Works Opole',
  'Litware Cold Store Gliwice',
  'Proseware Print Katowice',
];

async function main() {
  const rows = SEED_NAMES.map((name) => ({ name, isActive: true }));
  const inserted = await db
    .insert(projects)
    .values(rows)
    .onConflictDoNothing({ target: projects.name })
    .returning({ id: projects.id, name: projects.name });

  logger.info(
    { requested: rows.length, inserted: inserted.length, skipped: rows.length - inserted.length },
    'Project seed finished',
  );
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, 'Project seed failed');
  process.exit(1);
});
