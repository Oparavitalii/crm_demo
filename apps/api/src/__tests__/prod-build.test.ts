import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(apiRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const dockerfile = readFileSync(join(apiRoot, 'Dockerfile'), 'utf8');

// Production ran `npm run start` -> `tsx src/index.ts`, transpiling 232 TS
// files on every machine boot. Measured on prod 2026-07-28: 17s from machine
// start to `API started`, of which the DB warm-up was 77ms. Requests arriving
// in that window wait for a port that is not open yet.
describe('production runtime does not depend on tsx', () => {
  it('start scripts run compiled output', () => {
    expect(pkg.scripts.start).toBe('node dist/index.js');
    expect(pkg.scripts['start:cron']).toBe('node dist/cron/scheduler.js');
  });

  it('the Fly release_command target is compiled too', () => {
    // fly.toml runs `npm run db:migrate:prod` as release_command inside the
    // RUNTIME image. Leaving it on tsx breaks every deploy the moment tsx
    // stops being a production dependency.
    expect(pkg.scripts['db:migrate:prod']).toBe('node dist/scripts/migrate.js');
  });

  it('tsx is a dev dependency only', () => {
    expect(pkg.devDependencies.tsx).toBeDefined();
    expect(pkg.dependencies.tsx).toBeUndefined();
  });

  it('esbuild is declared explicitly — the build script imports it directly', () => {
    expect(pkg.devDependencies.esbuild).toBeDefined();
  });

  it('the Dockerfile builds in one stage and ships another', () => {
    expect(dockerfile).toMatch(/AS builder/);
    expect(dockerfile).toMatch(/COPY --from=builder/);
    expect(dockerfile).toMatch(/CMD \["node", "apps\/api\/dist\/index\.js"\]/);
  });

  it('fly.toml runs node directly — no npm wrapper in production', () => {
    // [processes] overrides CMD entirely, so leaving `npm run ... -w` there
    // would keep the ~29 MB npm process resident for the machine's lifetime
    // and would also pin WORKDIR to the workspace root.
    const flyToml = readFileSync(join(apiRoot, '..', '..', 'fly.toml'), 'utf8');
    expect(flyToml).toMatch(/app\s*=\s*"node apps\/api\/dist\/index\.js"/);
    expect(flyToml).toMatch(/cron\s*=\s*"node apps\/api\/dist\/cron\/scheduler\.js"/);
    expect(flyToml).toMatch(
      /release_command\s*=\s*"node apps\/api\/dist\/scripts\/migrate\.js"/,
    );
  });

  it('migrations land where the compiled migrator looks for them', () => {
    // scripts/migrate.ts resolves `new URL('../db/migrations', import.meta.url)`
    // — relative to itself. Compiled that is dist/scripts/migrate.js, so the
    // folder must be at dist/db/migrations. Source is src/db/migrations per
    // drizzle.config.ts `out`.
    expect(dockerfile).toMatch(
      /COPY apps\/api\/src\/db\/migrations \.\/apps\/api\/dist\/db\/migrations/,
    );
  });
});
