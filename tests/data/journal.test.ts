import type { MigrationDialect } from '../../src/data/migrate.ts';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { migrationsFolderFor } from '../../src/data/migrate.ts';

/** One journal entry, as far as the guard reads it. */
type Entry = { idx: number, tag: string, when: number };

/** The journal file's shape, as far as the guard reads it. */
type Journal = { entries: Entry[] };

const DIALECTS: readonly MigrationDialect[] = ['sqlite', 'pg'];

/**
 * Lists what would make drizzle-orm 0.45.4's migrator skip a migration silently: it runs an entry
 * only when its `when` is later than the newest applied `created_at`, so every `when` must be
 * later than the one before it (https://github.com/drizzle-team/drizzle-orm/issues/5769).
 */
function journalProblems(journal: Journal): string[] {
  const problems: string[] = [];
  journal.entries.forEach((entry, position) => {
    if (!Number.isFinite(entry.when)) problems.push(`${entry.tag}: when is not a number`);
    if (entry.idx !== position) problems.push(`${entry.tag}: idx ${entry.idx} is not ${position}`);
    const previous = journal.entries[position - 1];
    if (previous !== undefined && entry.when <= previous.when) {
      problems.push(`${entry.tag}: when ${entry.when} is not later than ${previous.tag} (${previous.when})`);
    }
  });
  return problems;
}

function readJournal(dialect: MigrationDialect): Journal {
  const path = join(migrationsFolderFor(dialect), 'meta', '_journal.json');
  return JSON.parse(readFileSync(path).toString()) as Journal;
}

describe('journalProblems (the failing control)', () => {
  test('reports a made-up journal whose when decreases', () => {
    const journal: Journal = {
      entries: [
        { idx: 0, tag: '0000_first', when: 2000 },
        { idx: 1, tag: '0001_second', when: 1000 },
      ],
    };

    expect(journalProblems(journal)).toEqual([
      '0001_second: when 1000 is not later than 0000_first (2000)',
    ]);
  });

  test('reports an equal when', () => {
    const journal: Journal = {
      entries: [
        { idx: 0, tag: '0000_first', when: 1000 },
        { idx: 1, tag: '0001_second', when: 1000 },
      ],
    };

    expect(journalProblems(journal)).toHaveLength(1);
  });

  test('reports an idx out of order and a when that is not a number', () => {
    const journal: Journal = { entries: [{ idx: 3, tag: '0000_first', when: Number.NaN }] };

    expect(journalProblems(journal)).toHaveLength(2);
  });

  test('accepts an empty journal and an increasing one', () => {
    expect(journalProblems({ entries: [] })).toEqual([]);
    expect(journalProblems({
      entries: [
        { idx: 0, tag: '0000_first', when: 1000 },
        { idx: 1, tag: '0001_second', when: 1001 },
      ],
    })).toEqual([]);
  });
});

describe.each(DIALECTS)('the %s journal', (dialect) => {
  test('has a strictly increasing when on every entry', () => {
    expect(journalProblems(readJournal(dialect))).toEqual([]);
  });

  test('has a migration file for every entry', () => {
    const missing = readJournal(dialect).entries
      .map((entry) => `${entry.tag}.sql`)
      .filter((file) => !existsSync(join(migrationsFolderFor(dialect), file)));

    expect(missing).toEqual([]);
  });
});
