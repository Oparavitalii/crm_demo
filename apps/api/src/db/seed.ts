import { randomBytes } from 'node:crypto';
import { db } from './client';
import { users } from './tables/users';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../lib/bcrypt';
import { env } from '../env';
import { logger } from '../lib/logger';

async function main() {
  // Normalize email to lowercase — findByEmail uses lowercased lookup.
  // Without normalization here, ADMIN_EMAIL=Admin@CRM-DEMO.example breaks login silently.
  const email = (env.ADMIN_EMAIL ?? 'admin@crm-demo.example').toLowerCase().trim();
  const explicitPassword = env.ADMIN_PASSWORD;
  const generated = !explicitPassword;
  const password = explicitPassword ?? randomBytes(16).toString('base64url');

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    logger.info({ email }, 'Admin already exists — skipping seed');
    process.exit(0);
  }

  const hash = await hashPassword(password);
  await db.insert(users).values({
    email,
    passwordHash: hash,
    firstName: 'Admin',
    lastName: 'CRM Demo',
    role: 'admin',
    isActive: true,
  });

  logger.info({ email }, 'Admin user created');
  if (generated) {
    // Print to stderr so operators can capture it; never stored anywhere
    process.stderr.write(`\n========================================\n`);
    process.stderr.write(`Generated admin password (save this!):\n`);
    process.stderr.write(`  ${password}\n`);
    process.stderr.write(`========================================\n\n`);
  }
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});
