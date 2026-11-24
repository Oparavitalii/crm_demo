import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// .env lives at monorepo root, not in apps/api/. drizzle-kit runs from apps/api/ cwd
// when invoked via `npm run db:* -w @opushr/api`, so we resolve the root .env explicitly.
config({ path: '../../.env' });

const url = process.env.DATABASE_URL_DIRECT;
if (!url) throw new Error('DATABASE_URL_DIRECT is required for migrations');

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
