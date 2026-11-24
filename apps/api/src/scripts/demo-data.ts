// Demo data CLI.
//   node dist/scripts/demo-data.js           seed the fictional agency (idempotent)
//   node dist/scripts/demo-data.js --reset   drop schema, migrate, seed (DEMO_MODE only)
// Locally: npm run db:seed-demo -w @crm/api / npm run db:reset-demo -w @crm/api
import { env } from '../env';
import { logger } from '../lib/logger';
import { resetDemo } from '../demo/reset';
import { seedDemo } from '../demo/seed';

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const summary = reset ? await resetDemo() : await seedDemo();
  if (summary.skipped) {
    logger.info({ email: env.DEMO_USER_EMAIL }, 'Demo data already present — skipping seed');
  } else {
    logger.info(summary, reset ? 'Demo data reset' : 'Demo data seeded');
    // The password itself is never printed: it may have been overridden.
    process.stderr.write(`\nDemo login: ${env.DEMO_USER_EMAIL} (password: DEMO_USER_PASSWORD, default in README)\n\n`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Demo data failed:', err);
    process.exit(1);
  });
