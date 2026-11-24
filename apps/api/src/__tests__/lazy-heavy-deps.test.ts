import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');

// `import type` is erased at compile time and costs nothing at runtime, so
// only VALUE imports are rejected here.
const valueImportFrom = (pkg: string) =>
  new RegExp(String.raw`^import\s+(?!type\s)[^;]*from ['"]${pkg}`, 'm');

describe('heavy SDKs are not pulled into the boot module graph', () => {
  // index.ts imports every router eagerly, so anything statically imported by
  // a service is resident in every request-serving process from startup.
  it('dismissals.service.ts does not statically import exceljs', () => {
    const code = src('services/dismissals.service.ts');
    expect(code).not.toMatch(valueImportFrom('exceljs'));
    expect(code).toMatch(/await import\(['"]exceljs['"]\)/);
  });

  it('r2.client.ts does not statically import the AWS SDK', () => {
    const code = src('clients/r2.client.ts');
    expect(code).not.toMatch(valueImportFrom(String.raw`@aws-sdk/`));
    expect(code).toMatch(/await import\(['"]@aws-sdk\/client-s3['"]\)/);
    expect(code).toMatch(/await import\(['"]@aws-sdk\/s3-request-presigner['"]\)/);
  });

  // jobs/backup.ts is a standalone script, not reachable from index.ts, so its
  // static import costs the API nothing. Guard that it stays that way.
  it('jobs/backup.ts is not reachable from the server entrypoint', () => {
    const index = src('index.ts');
    expect(index).not.toMatch(/jobs\/backup/);
  });
});
