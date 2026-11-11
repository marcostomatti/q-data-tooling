import { describe, expect, test } from 'bun:test';

import {
  columnsToRows,
  splitForm,
  SubmissionsHeader,
  toFiling,
  withinRetention,
} from '../../src/sec/parse.ts';

/**
 * The parsers over `tests/fixtures/sec/aapl-submissions.json`, a copy of Apple's whole
 * submissions file: 1001 rows parse with 0 failures, and at `now = 2026-11-11` the last-year cut
 * keeps 94 rows, 13 of them in the three tracked forms (1 x 10-K, 3 x 10-Q, 9 x 8-K) counted by the form as filed; the one 8-K/A
 * makes 14 when amendments count under their base form.
 */

const CIK = 320193;
const NOW = new Date('2026-11-11T12:00:00.000Z');
const TRACKED_FORMS = ['10-K', '10-Q', '8-K'];

const raw: unknown = await Bun.file(new URL('../fixtures/sec/aapl-submissions.json', import.meta.url)).json();
const header = SubmissionsHeader.parse(raw);
const rows = columnsToRows(header.filings.recent);

describe('Apple submissions contract', () => {
  test('parses all 1001 rows with 0 failures', () => {
    // Arrange
    const failures: unknown[] = [];

    // Act
    const filings = rows.flatMap((row) => {
      try {
        return [toFiling(CIK, row)];
      } catch (error) {
        failures.push(error);
        return [];
      }
    });

    // Assert
    expect(rows).toHaveLength(1001);
    expect(failures).toEqual([]);
    expect(filings).toHaveLength(1001);
  });

  test('keeps 94 rows in the last year at now = 2026-11-11', () => {
    expect(withinRetention(rows, NOW)).toHaveLength(94);
  });

  test('counts 13 tracked rows in the last year by form as filed: 1 10-K, 3 10-Q, 9 8-K', () => {
    // Arrange
    const lastYear = withinRetention(rows, NOW);

    // Act
    const counts = Object.fromEntries(
      TRACKED_FORMS.map((form) => [form, lastYear.filter((r) => r.form === form).length]),
    );

    // Assert
    expect(counts).toEqual({ '10-K': 1, '10-Q': 3, '8-K': 9 });
  });

  test('counts the one 8-K/A of the last year under the 8-K base form, making 14 with amendments', () => {
    // Arrange
    const lastYear = withinRetention(rows, NOW);

    // Act
    const amendments = lastYear.filter((r) => splitForm(r.form).isAmendment);
    const trackedWithAmendments = lastYear.filter((r) => TRACKED_FORMS.includes(splitForm(r.form).baseForm));

    // Assert
    expect(amendments.filter((r) => r.form === '8-K/A')).toHaveLength(1);
    expect(trackedWithAmendments).toHaveLength(14);
  });
});
