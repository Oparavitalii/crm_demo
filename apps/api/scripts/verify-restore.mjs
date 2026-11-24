// Verifies a restore: counts rows per table in the plain-format pg_dump on
// disk, counts them again in the database the dump was just applied to, and
// exits non-zero on ANY mismatch.
//
// Usage: node scripts/verify-restore.mjs <dump.sql>
//        DATABASE_URL_DIRECT must point at the RESTORE TARGET, never at
//        production.
//
// The expected numbers come from the dump itself, so there is nothing to keep
// up to date as the data grows — the check compares the backup against what
// the backup actually produced. A drill with hardcoded row counts stops being
// a check the first time someone adds a table.
//
// Prints table names and counts only. The dump is production personal data;
// no row, no column value, and no connection string may ever reach the log.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const dumpPath = process.argv[2];
if (!dumpPath) {
  console.error('usage: node scripts/verify-restore.mjs <dump.sql>');
  process.exit(1);
}

const url = process.env.DATABASE_URL_DIRECT;
if (!url) {
  console.error('DATABASE_URL_DIRECT is not set — refusing to guess a target');
  process.exit(1);
}

// pg_dump writes `COPY <schema>.<table> (cols) FROM stdin;`, rows, then `\.`
// Schema-qualified on both sides: `drizzle.__drizzle_migrations` carries the
// applied-migration list, and a restore that loses it leaves the next
// db:migrate believing all 57 migrations are pending.
async function countsFromDump(path) {
  const counts = new Map();
  let current = null;
  let rows = 0;

  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (current !== null) {
      if (line === '\\.') {
        counts.set(current, rows);
        current = null;
        rows = 0;
      } else {
        rows++;
      }
      continue;
    }
    const m = /^COPY "?([A-Za-z0-9_]+)"?\."?([A-Za-z0-9_]+)"? \(/.exec(line);
    if (m) {
      current = `${m[1]}.${m[2]}`;
      rows = 0;
    }
  }
  return counts;
}

async function countsFromDb(connectionString, tables) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 20_000 });
  await client.connect();
  try {
    const counts = new Map();
    for (const qualified of tables) {
      const [schema, table] = qualified.split('.');
      // Both halves come from the dump's own COPY lines and are matched by
      // [A-Za-z0-9_]+ above, so they cannot carry an identifier break-out.
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM "${schema}"."${table}"`,
      );
      counts.set(qualified, rows[0].n);
    }
    return counts;
  } finally {
    await client.end();
  }
}

const expected = await countsFromDump(dumpPath);
if (expected.size === 0) {
  console.error(`no COPY blocks found in ${dumpPath} — is this a plain-format pg_dump?`);
  process.exit(1);
}

let actual;
try {
  actual = await countsFromDb(url, [...expected.keys()]);
} catch (err) {
  // Print the message only. A pg connection error can echo the host, and the
  // full error object has carried connection strings in some driver versions.
  console.error(`could not read the restore target: ${err.message}`);
  process.exit(1);
}

let mismatches = 0;
let total = 0;
console.log('   dump       db  table');
for (const [table, want] of [...expected].sort(([a], [b]) => a.localeCompare(b))) {
  const got = actual.get(table);
  total += want;
  const ok = got === want;
  if (!ok) mismatches++;
  console.log(
    `${String(want).padStart(7)}  ${String(got).padStart(7)}  ${table}${ok ? '' : '   <-- MISMATCH'}`,
  );
}

console.log(`\ntables: ${expected.size}   rows in dump: ${total}`);

if (mismatches > 0) {
  console.error(
    `\nFAILED: ${mismatches} table(s) differ. The backup did not restore faithfully — ` +
      'treat this as a bug in backup.ts or restore.ts, not an acceptable variance.',
  );
  process.exit(1);
}

console.log('\nOK — every table restored with the row count the dump carried.');
