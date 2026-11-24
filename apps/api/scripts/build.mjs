// Production build. Bundles the app's own source (and @opushr/shared) into
// plain JS so the runtime image can run `node dist/index.js` instead of
// `npm run start` -> `tsx src/index.ts`.
//
// Why this exists: on 2026-07-28 prod took 17 seconds from machine start to
// `API started` — the DB warm-up inside that was 77ms, the rest was npm plus
// tsx transpiling 232 TS files on one shared vCPU. It also kept three extra
// processes resident for the machine's lifetime (npm ~29 MB, the tsx parent
// node ~13 MB, esbuild ~6 MB) on a box that had 13 MB free after three days.
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

// Everything in `dependencies` stays external and is resolved from
// node_modules at runtime — EXCEPT @opushr/shared, whose package.json points
// `exports` at raw .ts source. Bundling it is what makes the output runnable
// by plain node.
const external = Object.keys(pkg.dependencies).filter((d) => d !== '@opushr/shared');

await build({
  // Entrypoints: the API server, the cron worker, the migrator that fly.toml
  // runs as release_command, the backup/restore jobs (invoked by hand or by
  // .github/workflows/backup.yml — never by the server or cron process), and
  // the demo-data CLI (seed / reset of the public demo).
  entryPoints: [
    'src/index.ts',
    'src/cron/scheduler.ts',
    'src/scripts/migrate.ts',
    'src/jobs/backup.ts',
    'src/jobs/restore.ts',
    'src/scripts/demo-data.ts',
  ],
  outdir: 'dist',
  // Keeps the layout: dist/index.js, dist/cron/scheduler.js,
  // dist/scripts/migrate.js, dist/jobs/backup.js, dist/jobs/restore.js.
  // migrate.js resolves its migrations folder relative to itself, so this
  // layout is load-bearing — see the Dockerfile.
  outbase: 'src',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external,
  sourcemap: true,
  logLevel: 'info',
});
