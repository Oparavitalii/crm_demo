import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Guards src/db/migrations/meta/_journal.json against drift that would make
// drizzle-orm's migrator silently skip a migration. Background:
// docs/Engineering_Rules.md (Database) — 57 hand-numbered .sql migrations
// but only 19 snapshots (0000-0018); migrations 0019-0056 were hand-written
// with round-number `when` values.
//
// Verified in node_modules/drizzle-orm/pg-core/dialect.cjs: pending
// migrations are selected by comparing the journal's `when` against the
// highest `created_at` already applied — NOT by hash or idx. A `when` that
// is not strictly greater than every earlier entry is skipped SILENTLY and
// PERMANENTLY, on every environment, with no error and no failed deploy.
//
// Deliberately NOT asserted here: that every journal entry has a matching
// meta/<tag>_snapshot.json. Only 19 of 57 entries do (0000-0018) — that gap
// is the drift docs/Engineering_Rules.md (Database) documents and is
// being tolerated for now, not fixed by this test. Do not add a
// snapshot-coverage assertion; it would fail immediately against real data
// and is not the invariant this test guards.

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations', import.meta.url));

function readJournal(migrationsDir: string): Journal {
  const raw = readFileSync(path.join(migrationsDir, 'meta', '_journal.json'), 'utf-8');
  return JSON.parse(raw) as Journal;
}

function readSqlFileNames(migrationsDir: string): string[] {
  return readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'));
}

describe('migrations journal integrity', () => {
  const journal = readJournal(MIGRATIONS_DIR);
  const sqlFiles = readSqlFileNames(MIGRATIONS_DIR);

  it('has a .sql file on disk for every journal entry', () => {
    const missing = journal.entries
      .map((entry) => `${entry.tag}.sql`)
      .filter((fileName) => !sqlFiles.includes(fileName));

    expect(missing, `journal entries with no matching .sql file: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  it('has a journal entry for every .sql file on disk', () => {
    const tags = new Set(journal.entries.map((entry) => entry.tag));
    const orphaned = sqlFiles.filter((fileName) => !tags.has(fileName.replace(/\.sql$/, '')));

    expect(orphaned, `.sql files with no journal entry: ${orphaned.join(', ')}`).toEqual([]);
  });

  it('has strictly increasing `when` values in journal order', () => {
    const violations: string[] = [];
    for (let i = 1; i < journal.entries.length; i++) {
      const prev = journal.entries[i - 1];
      const curr = journal.entries[i];
      if (!prev || !curr) continue;
      if (curr.when <= prev.when) {
        violations.push(
          `entry ${i} (${curr.tag}, when=${curr.when}) is not strictly greater than ` +
            `entry ${i - 1} (${prev.tag}, when=${prev.when})`,
        );
      }
    }

    expect(
      violations,
      [
        'Journal `when` values must strictly increase in entry order.',
        'drizzle-orm selects pending migrations by comparing this `when` against the',
        'highest `created_at` already applied (pg-core/dialect.cjs) — NOT by hash or',
        'idx. A `when` that is not strictly greater than every prior entry is skipped',
        'SILENTLY and PERMANENTLY on every environment: no error, no failed deploy,',
        'just a schema that no longer matches the code. Fix by giving the offending',
        'entry a real, larger `when` (see docs/Engineering_Rules.md (Database)).',
        ...violations,
      ].join('\n'),
    ).toEqual([]);
  });

  it('has no duplicate `when` values', () => {
    const seen = new Map<number, string[]>();
    for (const entry of journal.entries) {
      const tags = seen.get(entry.when) ?? [];
      tags.push(entry.tag);
      seen.set(entry.when, tags);
    }
    const duplicates = [...seen.entries()].filter(([, tags]) => tags.length > 1);

    expect(
      duplicates,
      `duplicate \`when\` values: ${duplicates
        .map(([when, tags]) => `${when} -> [${tags.join(', ')}]`)
        .join('; ')}`,
    ).toEqual([]);
  });
});
