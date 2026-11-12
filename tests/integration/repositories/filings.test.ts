import type { FilingPageFilter, FilingSummaryFilter } from '../../../src/data/repositories/filings.ts';
import type { TestDatabase } from '../../support/test-db.ts';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { deleteFilingsBefore, INSERT_CHUNK_SIZE, insertFilings, pageFilings, summarizeSelectedFilings } from '../../../src/data/repositories/filings.ts';
import { seedTickers } from '../../../src/data/seeds/01-companies.ts';
import { Filing } from '../../../src/entities/filing.ts';
import { CompanySummary } from '../../../src/routes/filings/contract.ts';
import { openTestDatabase } from '../../support/test-db.ts';

/** Three companies shaped like the SEC ticker file, named so the summary's name order is AGNICO, Apple, Walmart. */
const TICKERS = {
  '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  '1': { cik_str: 2809, ticker: 'AEM', title: 'AGNICO EAGLE MINES LTD' },
  '2': { cik_str: 104169, ticker: 'WMT', title: 'Walmart Inc.' },
};

const APPLE = 320193;
const AGNICO = 2809;
const WALMART = 104169;

/** Every filing of one company, newest first, in one window wide enough for all of them. */
const EVERY: Omit<FilingPageFilter, 'cik'> = { form: undefined, sort: '-filingDate', offset: 0, limit: 100 };

/** Every selected company, in one window wide enough for all of them. */
const ALL_SELECTED: FilingSummaryFilter = { form: undefined, offset: 0, limit: 100 };

/** A company's counts with every bucket at 0, so a case spells only the buckets it fills. */
const ZERO_COUNTS = { '10-K': 0, '10-Q': 0, '8-K': 0, '6-K': 0, '4': 0, '144': 0, other: 0, total: 0 };

/** A company's newest filing dates with no bucket filed. */
const NO_DATES = { '10-K': null, '10-Q': null, '8-K': null, '6-K': null, '4': null, '144': null, other: null };

let database: TestDatabase;
let db: TestDatabase['db'];

beforeAll(async () => {
  database = await openTestDatabase();
  db = database.db;
});

beforeEach(async () => {
  await database.reset();
  await seedTickers(db, TICKERS);
});

afterAll(async () => {
  await database.close();
});

/**
 * A valid filing of `cik`, its accession number made from `sequence`, its links built the way the
 * SEC spells them. `overrides` replaces any field.
 */
function filingOf(cik: number, sequence: number, overrides: Partial<Filing> = {}): Filing {
  const accessionNumber = `${String(cik).padStart(10, '0')}-26-${String(sequence).padStart(6, '0')}`;
  const folder = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNumber.replaceAll('-', '')}`;
  return Filing.parse({
    accessionNumber,
    cik,
    form: '8-K',
    baseForm: '8-K',
    isAmendment: false,
    filingDate: '2026-06-01',
    reportDate: null,
    acceptedAt: '2026-06-01T16:05:00.000Z',
    act: '34',
    fileNumber: '001-36743',
    filmNumber: null,
    items: ['8.01', '9.01'],
    sizeBytes: 1234,
    isXbrl: true,
    isInlineXbrl: true,
    primaryDocument: `doc-${sequence}.htm`,
    description: null,
    links: {
      document: `${folder}/doc-${sequence}.htm`,
      index: `${folder}/${accessionNumber}-index.htm`,
      folderJson: `${folder}/index.json`,
      inlineXbrlViewer: `https://www.sec.gov/ix?doc=/Archives/edgar/data/${cik}/${accessionNumber.replaceAll('-', '')}/doc-${sequence}.htm`,
      rawXml: null,
    },
    ...overrides,
  });
}

/** The count of stored filings, read with SQL so a test does not lean on the code it tests. */
async function storedCount(): Promise<number> {
  const [row] = await database.sql<{ n: number }[]>`select count(*)::int as n from filings`;
  return row?.n ?? 0;
}

/** The accession numbers `filter` pages for `cik`, in the order it pages them. */
async function pagedAccessions(cik: number, filter: Partial<FilingPageFilter> = {}): Promise<string[]> {
  const page = await pageFilings(db, { ...EVERY, cik, ...filter });
  return page.items.map((filing) => filing.accessionNumber);
}

/** Marks the companies with `ciks` selected with SQL. */
async function selectWithSql(...ciks: number[]): Promise<void> {
  await database.sql`update companies set selected = true where cik in ${database.sql(ciks)}`;
}

describe('insertFilings', () => {
  test('stores each filing so it reads back as the same Filing entity', async () => {
    // Arrange
    const amended = filingOf(APPLE, 1, { form: '10-K/A', baseForm: '10-K', isAmendment: true, reportDate: '2026-09-26', items: [] });
    const plain = filingOf(APPLE, 2, { isInlineXbrl: false, links: { ...filingOf(APPLE, 2).links, inlineXbrlViewer: null, rawXml: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000002/primary_doc.xml' } });

    // Act
    const inserted = await insertFilings(db, [amended, plain]);
    const page = await pageFilings(db, { ...EVERY, cik: APPLE, sort: 'filingDate' });

    // Assert
    expect(inserted).toBe(2);
    expect(page.items.toSorted((a, b) => a.accessionNumber.localeCompare(b.accessionNumber))).toEqual([amended, plain]);
    for (const filing of page.items) expect(Filing.parse(filing)).toEqual(filing);
  });

  test('skips a filing whose accession number is stored, keeping the stored copy', async () => {
    // Arrange
    const original = filingOf(APPLE, 1, { description: 'first copy' });
    await insertFilings(db, [original]);

    // Act
    const inserted = await insertFilings(db, [{ ...original, description: 'second copy' }, filingOf(APPLE, 2)]);
    const page = await pageFilings(db, { ...EVERY, cik: APPLE });

    // Assert
    expect(inserted).toBe(1);
    expect(page.total).toBe(2);
    expect(page.items.find((filing) => filing.accessionNumber === original.accessionNumber)?.description).toBe('first copy');
  });

  test('inserts nothing the second time the same filings are written', async () => {
    // Arrange
    const rows = [filingOf(APPLE, 1), filingOf(APPLE, 2), filingOf(WALMART, 3)];
    await insertFilings(db, rows);

    // Act
    const inserted = await insertFilings(db, rows);

    // Assert
    expect(inserted).toBe(0);
    expect(await storedCount()).toBe(3);
  });

  test('answers 0 for no filings', async () => {
    // Act / Assert
    expect(await insertFilings(db, [])).toBe(0);
    expect(await storedCount()).toBe(0);
  });

  test('stores more filings than one statement can bind, in chunks', async () => {
    // Arrange: 3,000 filings bind 66,000 values; one unchunked statement is refused from 2,979 rows,
    // where the values pass 65,535
    const rows = Array.from({ length: 3000 }, (_, index) => filingOf(APPLE, index + 1));

    // Act
    const inserted = await insertFilings(db, rows);

    // Assert
    expect(inserted).toBe(3000);
    expect(await storedCount()).toBe(3000);
  });

  test('stores none of the filings when a later chunk is refused', async () => {
    // Arrange: the one refused row sits in the second chunk, after a full first chunk
    const rows = Array.from({ length: INSERT_CHUNK_SIZE + 1 }, (_, index) => filingOf(APPLE, index + 1));
    const refused = [...rows.slice(0, INSERT_CHUNK_SIZE), { ...rows[INSERT_CHUNK_SIZE]!, form: null as unknown as string }];

    // Act / Assert
    await expect(insertFilings(db, refused)).rejects.toThrow();
    expect(await storedCount()).toBe(0);
  });
});

describe('deleteFilingsBefore', () => {
  test('deletes the company filings before the cutoff, keeping the cutoff day, later days and other companies', async () => {
    // Arrange
    await insertFilings(db, [
      filingOf(APPLE, 1, { filingDate: '2025-11-10' }),
      filingOf(APPLE, 2, { filingDate: '2025-11-11' }),
      filingOf(APPLE, 3, { filingDate: '2026-03-01' }),
      filingOf(WALMART, 4, { filingDate: '2025-01-01' }),
    ]);

    // Act
    const deleted = await deleteFilingsBefore(db, APPLE, '2025-11-11');

    // Assert
    expect(deleted).toBe(1);
    expect(await pagedAccessions(APPLE)).toEqual([filingOf(APPLE, 3).accessionNumber, filingOf(APPLE, 2).accessionNumber]);
    expect(await pagedAccessions(WALMART)).toEqual([filingOf(WALMART, 4).accessionNumber]);
  });

  test('answers 0 when the company has nothing before the cutoff', async () => {
    // Arrange
    await insertFilings(db, [filingOf(APPLE, 1, { filingDate: '2026-03-01' })]);

    // Act / Assert
    expect(await deleteFilingsBefore(db, APPLE, '2026-01-01')).toBe(0);
    expect(await storedCount()).toBe(1);
  });

  test('refuses a cutoff not spelled YYYY-MM-DD and deletes nothing', async () => {
    // Arrange: as text, every stored date sorts before `9`, so a loose cutoff would delete them all
    await insertFilings(db, [filingOf(APPLE, 1, { filingDate: '2026-03-01' })]);

    // Act / Assert
    await expect(deleteFilingsBefore(db, APPLE, '9')).rejects.toThrow(RangeError);
    await expect(deleteFilingsBefore(db, APPLE, '2026-03-01T00:00:00Z')).rejects.toThrow(RangeError);
    expect(await storedCount()).toBe(1);
  });
});

describe('pageFilings', () => {
  /** Apple's filings across three days and three forms, one an amendment, and one Walmart filing. */
  const APPLE_ROWS = [
    filingOf(APPLE, 1, { form: '10-K', baseForm: '10-K', filingDate: '2025-11-20' }),
    filingOf(APPLE, 2, { form: '10-Q', baseForm: '10-Q', filingDate: '2026-02-01' }),
    filingOf(APPLE, 3, { form: '10-K/A', baseForm: '10-K', isAmendment: true, filingDate: '2026-03-15' }),
    filingOf(APPLE, 4, { filingDate: '2026-05-05' }),
  ];

  beforeEach(async () => {
    await insertFilings(db, [...APPLE_ROWS, filingOf(WALMART, 9, { filingDate: '2026-05-06' })]);
  });

  test('lists the company filings newest first for -filingDate', async () => {
    // Act / Assert
    expect(await pagedAccessions(APPLE)).toEqual(APPLE_ROWS.map((filing) => filing.accessionNumber).toReversed());
  });

  test('lists the company filings oldest first for filingDate', async () => {
    // Act / Assert
    expect(await pagedAccessions(APPLE, { sort: 'filingDate' })).toEqual(APPLE_ROWS.map((filing) => filing.accessionNumber));
  });

  test('keeps a 10-K/A under the 10-K filter, marked as an amendment, and counts only the matches', async () => {
    // Act
    const page = await pageFilings(db, { ...EVERY, cik: APPLE, form: '10-K' });

    // Assert
    expect(page.items.map((filing) => [filing.form, filing.isAmendment])).toEqual([['10-K/A', true], ['10-K', false]]);
    expect(page.total).toBe(2);
  });

  test('orders filings of one day by acceptance time, the same way as the date', async () => {
    // Arrange: the accession numbers sort the other way, so only the acceptance time gives this order
    const morning = filingOf(AGNICO, 2, { filingDate: '2026-04-01', acceptedAt: '2026-04-01T09:00:00.000Z' });
    const evening = filingOf(AGNICO, 1, { filingDate: '2026-04-01', acceptedAt: '2026-04-01T17:00:00.000Z' });
    await insertFilings(db, [evening, morning]);

    // Act / Assert
    expect(await pagedAccessions(AGNICO)).toEqual([evening.accessionNumber, morning.accessionNumber]);
    expect(await pagedAccessions(AGNICO, { sort: 'filingDate' })).toEqual([morning.accessionNumber, evening.accessionNumber]);
  });

  test('pages in windows that neither overlap nor skip, each with the full total', async () => {
    // Act
    const first = await pageFilings(db, { ...EVERY, cik: APPLE, offset: 0, limit: 3 });
    const second = await pageFilings(db, { ...EVERY, cik: APPLE, offset: 3, limit: 3 });

    // Assert
    expect([...first.items, ...second.items].map((filing) => filing.accessionNumber))
      .toEqual(APPLE_ROWS.map((filing) => filing.accessionNumber).toReversed());
    expect([first.total, second.total]).toEqual([4, 4]);
  });

  test('keeps a named form under its own filter and every other base form under other', async () => {
    // Arrange
    const formFour = filingOf(APPLE, 5, { form: '4', baseForm: '4', filingDate: '2026-05-10', items: [] });
    const schedule = filingOf(APPLE, 6, { form: 'SCHEDULE 13G', baseForm: 'SCHEDULE 13G', filingDate: '2026-02-14', items: [] });
    const prospectus = filingOf(APPLE, 7, { form: '424B2', baseForm: '424B2', filingDate: '2026-03-01', items: [] });
    await insertFilings(db, [formFour, schedule, prospectus]);

    // Act
    const four = await pageFilings(db, { ...EVERY, cik: APPLE, form: '4' });
    const other = await pageFilings(db, { ...EVERY, cik: APPLE, form: 'other' });

    // Assert
    expect(four.items.map((filing) => filing.accessionNumber)).toEqual([formFour.accessionNumber]);
    expect(other.items.map((filing) => filing.form)).toEqual(['424B2', 'SCHEDULE 13G']);
    expect(other.total).toBe(2);
  });

  test('answers the window past the last match with no items and the real total', async () => {
    // Act / Assert
    expect(await pageFilings(db, { ...EVERY, cik: APPLE, offset: 100, limit: 25 })).toEqual({ items: [], total: 4 });
  });

  test('answers a company with no filings with no items and a total of 0', async () => {
    // Act / Assert
    expect(await pageFilings(db, { ...EVERY, cik: AGNICO })).toEqual({ items: [], total: 0 });
  });
});

describe('summarizeSelectedFilings', () => {
  /** The 10-K the summary must answer for Apple: the newest one, an amendment, later than the original. */
  const APPLE_LATEST_10K = filingOf(APPLE, 2, { form: '10-K/A', baseForm: '10-K', isAmendment: true, filingDate: '2026-01-10' });

  beforeEach(async () => {
    await insertFilings(db, [
      filingOf(APPLE, 1, { form: '10-K', baseForm: '10-K', filingDate: '2025-11-20' }),
      APPLE_LATEST_10K,
      filingOf(APPLE, 3, { form: '10-Q', baseForm: '10-Q', filingDate: '2026-02-01' }),
      filingOf(APPLE, 4, { filingDate: '2026-05-05' }),
      filingOf(APPLE, 5, { filingDate: '2026-06-05' }),
      filingOf(AGNICO, 6, { form: '10-Q', baseForm: '10-Q', filingDate: '2026-04-30' }),
      filingOf(WALMART, 7, { form: '10-K', baseForm: '10-K', filingDate: '2026-03-20' }),
      filingOf(APPLE, 8, { form: '4', baseForm: '4', filingDate: '2026-06-10', items: [] }),
      filingOf(APPLE, 9, { form: 'SCHEDULE 13G', baseForm: 'SCHEDULE 13G', filingDate: '2026-02-14', items: [] }),
      filingOf(APPLE, 10, { form: '424B2', baseForm: '424B2', filingDate: '2026-03-01', items: [] }),
      filingOf(AGNICO, 11, { form: '6-K', baseForm: '6-K', filingDate: '2026-05-20', items: [] }),
    ]);
  });

  test('summarizes only the selected companies, by name, each a valid CompanySummary', async () => {
    // Arrange: Walmart has filings but is not selected
    await selectWithSql(APPLE, AGNICO);
    await database.sql`update companies set filings_synced_at = to_timestamp(${1_785_000_000}) where cik = ${APPLE}`;

    // Act
    const page = await summarizeSelectedFilings(db, ALL_SELECTED);

    // Assert
    expect(page.total).toBe(2);
    expect(page.items).toEqual([
      {
        cik: AGNICO,
        ticker: 'AEM',
        name: 'AGNICO EAGLE MINES LTD',
        counts: { ...ZERO_COUNTS, '10-Q': 1, '6-K': 1, total: 2 },
        lastFiled: { ...NO_DATES, '10-Q': '2026-04-30', '6-K': '2026-05-20' },
        latest10K: null,
        filingsSyncedAt: null,
      },
      {
        cik: APPLE,
        ticker: 'AAPL',
        name: 'Apple Inc.',
        counts: { ...ZERO_COUNTS, '10-K': 2, '10-Q': 1, '8-K': 2, '4': 1, other: 2, total: 8 },
        lastFiled: { ...NO_DATES, '10-K': '2026-01-10', '10-Q': '2026-02-01', '8-K': '2026-06-05', '4': '2026-06-10', other: '2026-03-01' },
        latest10K: { filingDate: '2026-01-10', links: APPLE_LATEST_10K.links },
        filingsSyncedAt: new Date(1_785_000_000 * 1000).toISOString(),
      },
    ]);
    for (const summary of page.items) expect(CompanySummary.parse(summary)).toEqual(summary);
  });

  test('narrows the counts and last filing dates to one form and keeps every selected company and the latest 10-K', async () => {
    // Arrange
    await selectWithSql(APPLE, AGNICO);

    // Act
    const page = await summarizeSelectedFilings(db, { ...ALL_SELECTED, form: '8-K' });

    // Assert
    expect(page.total).toBe(2);
    expect(page.items.map((summary) => [summary.cik, summary.counts])).toEqual([
      [AGNICO, ZERO_COUNTS],
      [APPLE, { ...ZERO_COUNTS, '8-K': 2, total: 2 }],
    ]);
    expect(page.items[1]?.latest10K?.filingDate).toBe('2026-01-10');
    expect(page.items[1]?.lastFiled).toEqual({ ...NO_DATES, '8-K': '2026-06-05' });
  });

  test('narrows to other: every base form outside the named ones, in one bucket', async () => {
    // Arrange
    await selectWithSql(APPLE);

    // Act
    const page = await summarizeSelectedFilings(db, { ...ALL_SELECTED, form: 'other' });

    // Assert
    expect(page.items[0]?.counts).toEqual({ ...ZERO_COUNTS, other: 2, total: 2 });
    expect(page.items[0]?.lastFiled).toEqual({ ...NO_DATES, other: '2026-03-01' });
  });

  test('answers a selected company with no filings with zero counts and no latest 10-K', async () => {
    // Arrange
    await database.sql`delete from filings where cik = ${AGNICO}`;
    await selectWithSql(AGNICO);

    // Act / Assert
    expect(await summarizeSelectedFilings(db, ALL_SELECTED)).toEqual({
      items: [{
        cik: AGNICO,
        ticker: 'AEM',
        name: 'AGNICO EAGLE MINES LTD',
        counts: ZERO_COUNTS,
        lastFiled: NO_DATES,
        latest10K: null,
        filingsSyncedAt: null,
      }],
      total: 1,
    });
  });

  test('pages the selected companies, the window past the last empty with the real total', async () => {
    // Arrange
    await selectWithSql(APPLE, AGNICO, WALMART);

    // Act
    const first = await summarizeSelectedFilings(db, { ...ALL_SELECTED, offset: 0, limit: 2 });
    const second = await summarizeSelectedFilings(db, { ...ALL_SELECTED, offset: 2, limit: 2 });
    const past = await summarizeSelectedFilings(db, { ...ALL_SELECTED, offset: 10, limit: 2 });

    // Assert
    expect([...first.items, ...second.items].map((summary) => summary.ticker)).toEqual(['AEM', 'AAPL', 'WMT']);
    expect([first.total, second.total]).toEqual([3, 3]);
    expect(past).toEqual({ items: [], total: 3 });
  });

  test('answers no companies when none is selected', async () => {
    // Act / Assert
    expect(await summarizeSelectedFilings(db, ALL_SELECTED)).toEqual({ items: [], total: 0 });
  });
});
