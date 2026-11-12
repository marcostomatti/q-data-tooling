import { describe, expect, test } from 'bun:test';
import { ZodError } from 'zod';

import { Filing } from '../../src/entities/filing.ts';
import {
  buildLinks,
  columnsToRows,
  type FilingColumns,
  RETENTION_DAYS,
  type RawRow,
  retentionCutoff,
  splitForm,
  SubmissionsHeader,
  toFiling,
  withinRetention,
} from '../../src/sec/parse.ts';

/** Apple's CIK, unpadded, as the service keys it. */
const CIK = 320193;

/** The day the DoD's last-year cut is measured on. */
const NOW = new Date('2026-11-11T12:00:00.000Z');

/** Builds the folder URL of one filing, the way the "Link templates" table spells it. */
const folderOf = (cik: number, accession: string) => `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replaceAll('-', '')}`;

/**
 * Five rows in the shape of Apple's `filings.recent`, one per kind the DoD names: a 10-K (the
 * example of "Data normalization"), an 8-K with items, a Form 4 under an `xsl…/` folder and a
 * filing agent's accession prefix, a 424B2 with an empty `reportDate`, and an UPLOAD whose
 * primary document is a PDF, filed the day before the retention cutoff.
 */
const ROWS: readonly RawRow[] = [
  {
    accessionNumber: '0000320193-26-000026',
    filingDate: '2026-11-03',
    reportDate: '2026-09-26',
    acceptanceDateTime: '2026-11-03T13:05:15.000Z',
    act: '34',
    form: '10-K',
    fileNumber: '001-36743',
    filmNumber: '261514222',
    items: '',
    core_type: 'XBRL',
    size: 10902198,
    isXBRL: 1,
    isInlineXBRL: 1,
    isXBRLNumeric: 1,
    primaryDocument: 'aapl-20260926.htm',
    primaryDocDescription: '10-K',
  },
  {
    accessionNumber: '0000320193-26-000024',
    filingDate: '2026-10-30',
    reportDate: '2026-10-30',
    acceptanceDateTime: '2026-10-30T20:30:21.000Z',
    act: '34',
    form: '8-K',
    fileNumber: '001-36743',
    filmNumber: '261490000',
    items: '2.02,9.01',
    core_type: 'XBRL',
    size: 412345,
    isXBRL: 1,
    isInlineXBRL: 1,
    isXBRLNumeric: 0,
    primaryDocument: 'aapl-20261030.htm',
    primaryDocDescription: '8-K',
  },
  {
    accessionNumber: '0001140361-26-040001',
    filingDate: '2026-10-17',
    reportDate: '2026-10-15',
    acceptanceDateTime: '2026-10-17T22:00:55.000Z',
    act: '',
    form: '4',
    fileNumber: '',
    filmNumber: '',
    items: '',
    core_type: '4',
    size: 5123,
    isXBRL: 0,
    isInlineXBRL: 0,
    isXBRLNumeric: 0,
    primaryDocument: 'xslF345X06/form4.xml',
    primaryDocDescription: 'FORM 4',
  },
  {
    accessionNumber: '0001140361-26-020002',
    filingDate: '2026-05-05',
    reportDate: '',
    acceptanceDateTime: '2026-05-05T21:10:02.000Z',
    act: '33',
    form: '424B2',
    fileNumber: '333-280000',
    filmNumber: '26900000',
    items: '',
    core_type: '424B2',
    size: 380000,
    isXBRL: 0,
    isInlineXBRL: 0,
    isXBRLNumeric: 0,
    primaryDocument: 'ef20000000_424b2.htm',
    primaryDocDescription: '',
  },
  {
    accessionNumber: '0000000000-25-012345',
    filingDate: '2025-11-10',
    reportDate: '',
    acceptanceDateTime: '2025-11-10T16:00:00.000Z',
    act: '',
    form: 'UPLOAD',
    fileNumber: '',
    filmNumber: '',
    items: '',
    core_type: 'LETTER',
    size: 50000,
    isXBRL: 0,
    isInlineXBRL: 0,
    isXBRLNumeric: 0,
    primaryDocument: 'filename1.pdf',
    primaryDocDescription: '',
  },
];

/** The column keys in EDGAR's order. */
const COLUMN_KEYS = Object.keys(ROWS[0] as RawRow) as (keyof FilingColumns)[];

/** Turns rows back into EDGAR's column arrays, the shape `filings.recent` holds. */
function toColumns(rows: readonly RawRow[]): FilingColumns {
  return Object.fromEntries(COLUMN_KEYS.map((k) => [k, rows.map((r) => r[k])])) as FilingColumns;
}

/** One address with every field EDGAR may leave `null`. */
const ADDRESS = {
  street1: 'ONE EXAMPLE WAY',
  street2: null,
  city: 'EXAMPLE CITY',
  stateOrCountry: 'CA',
  zipCode: '00000',
  stateOrCountryDescription: 'CA',
  isForeignLocation: 0,
  foreignStateTerritory: null,
  country: null,
  countryCode: null,
};

/** A submissions document holding the five rows, with placeholder contact fields. */
const DOCUMENT = {
  cik: '0000320193',
  entityType: 'operating',
  sic: '3571',
  sicDescription: 'Electronic Computers',
  ownerOrg: '06 Technology',
  insiderTransactionForOwnerExists: 0,
  insiderTransactionForIssuerExists: 1,
  name: 'Apple Inc.',
  tickers: ['AAPL'],
  exchanges: ['Nasdaq'],
  ein: '942404110',
  lei: null,
  description: '',
  website: '',
  investorWebsite: '',
  category: 'Large accelerated filer',
  fiscalYearEnd: '0926',
  stateOfIncorporation: 'CA',
  stateOfIncorporationDescription: 'CA',
  addresses: { mailing: ADDRESS, business: ADDRESS },
  phone: '000-000-0000',
  flags: '',
  formerNames: [{ name: 'APPLE COMPUTER INC', from: '1994-01-26T00:00:00.000Z', to: '2007-01-04T00:00:00.000Z' }],
  filings: {
    recent: toColumns(ROWS),
    files: [{ name: 'CIK0000320193-submissions-001.json', filingCount: 1000, filingFrom: '1994-01-26', filingTo: '2015-01-01' }],
  },
};

/** The fixture row of the given form. */
function rowOf(form: string): RawRow {
  const row = ROWS.find((r) => r.form === form);
  if (row === undefined) {
    throw new Error(`fixture has no ${form} row`);
  }
  return row;
}

describe('SubmissionsHeader', () => {
  test('parses a submissions document and keeps its padded cik as text', () => {
    const header = SubmissionsHeader.parse(DOCUMENT);
    expect(header.cik).toBe('0000320193');
    expect(header.filings.recent.accessionNumber).toHaveLength(ROWS.length);
    expect(header.filings.files).toHaveLength(1);
  });

  test('accepts a field EDGAR adds without notice, at the top and in an address', () => {
    const withNewFields = {
      ...DOCUMENT,
      newTopLevelField: 'x',
      addresses: { ...DOCUMENT.addresses, business: { ...ADDRESS, newAddressField: 1 } },
    };
    expect(SubmissionsHeader.safeParse(withNewFields).success).toBe(true);
  });

  test('refuses a document whose filings are missing, so the loose schema still checks', () => {
    const { filings: _filings, ...withoutFilings } = DOCUMENT;
    expect(SubmissionsHeader.safeParse(withoutFilings).success).toBe(false);
  });

  test('refuses a number-typed column, the way a corrupt document would hold one', () => {
    const corrupt = {
      ...DOCUMENT,
      filings: { ...DOCUMENT.filings, recent: { ...DOCUMENT.filings.recent, size: ['10902198'] } },
    };
    expect(SubmissionsHeader.safeParse(corrupt).success).toBe(false);
  });
});

describe('columnsToRows', () => {
  test('zips the columns into one row per filing, in EDGAR order', () => {
    const rows = columnsToRows(SubmissionsHeader.parse(DOCUMENT).filings.recent);
    expect(rows).toEqual([...ROWS]);
    expect(rows[2]?.primaryDocument).toBe('xslF345X06/form4.xml');
    expect(rows[2]?.accessionNumber).toBe('0001140361-26-040001');
  });

  test('gives no rows for empty columns', () => {
    expect(columnsToRows(toColumns([]))).toEqual([]);
  });

  test('throws naming every column whose length differs from accessionNumber', () => {
    const cols = toColumns(ROWS);
    const misaligned = { ...cols, reportDate: cols.reportDate.slice(1), size: [...cols.size, 1] };
    expect(() => columnsToRows(misaligned)).toThrow('EDGAR columns misaligned: reportDate, size');
  });

  test('throws when accessionNumber itself is the short column', () => {
    const cols = toColumns(ROWS);
    const misaligned = { ...cols, accessionNumber: cols.accessionNumber.slice(1) };
    expect(() => columnsToRows(misaligned)).toThrow(/^EDGAR columns misaligned: filingDate, /);
  });
});

describe('withinRetention', () => {
  test('keeps one year, counted back RETENTION_DAYS from now in UTC', () => {
    expect(RETENTION_DAYS).toBe(365);
    expect(retentionCutoff(NOW)).toBe('2025-11-11');
  });

  test('drops the UPLOAD filed the day before the cutoff and keeps the other four', () => {
    const kept = withinRetention(ROWS, NOW);
    expect(kept.map((r) => r.form)).toEqual(['10-K', '8-K', '4', '424B2']);
  });

  test('keeps a filing on the cutoff date itself', () => {
    const onCutoff = { ...rowOf('UPLOAD'), filingDate: '2025-11-11' };
    expect(withinRetention([onCutoff], NOW)).toEqual([onCutoff]);
  });

  test('reads the cutoff in UTC, so a late-evening now west of UTC moves it a day', () => {
    expect(retentionCutoff(new Date('2026-11-11T23:30:00.000-08:00'))).toBe('2025-11-12');
  });
});

describe('splitForm', () => {
  test.each([
    ['10-K', '10-K', false],
    ['10-K/A', '10-K', true],
    ['10-Q/A', '10-Q', true],
    ['8-K', '8-K', false],
    ['SC 13G/A', 'SC 13G', true],
    ['4', '4', false],
  ])('%s is base form %s, amendment %p', (form, baseForm, isAmendment) => {
    expect(splitForm(form)).toEqual({ baseForm, isAmendment });
  });
});

describe('buildLinks', () => {
  test('builds the 10-K links of the example response data', () => {
    const folder = folderOf(CIK, '0000320193-26-000026');
    expect(buildLinks(CIK, '0000320193-26-000026', 'aapl-20260926.htm', true)).toEqual({
      document: `${folder}/aapl-20260926.htm`,
      index: `${folder}/0000320193-26-000026-index.htm`,
      folderJson: `${folder}/index.json`,
      inlineXbrlViewer: 'https://www.sec.gov/ix?doc=/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm',
      rawXml: null,
    });
  });

  test('keys the folder by the company CIK when the accession is a filing agent\'s', () => {
    const links = buildLinks(CIK, '0001140361-26-040001', 'xslF345X06/form4.xml', false);
    expect(links.index).toBe('https://www.sec.gov/Archives/edgar/data/320193/000114036126040001/0001140361-26-040001-index.htm');
    expect(links.document.includes('/data/1140361/')).toBe(false);
  });

  test('gives an xsl primary document a raw XML link without its xsl folder', () => {
    const folder = folderOf(CIK, '0001140361-26-040001');
    const links = buildLinks(CIK, '0001140361-26-040001', 'xslF345X06/form4.xml', false);
    expect(links.document).toBe(`${folder}/xslF345X06/form4.xml`);
    expect(links.rawXml).toBe(`${folder}/form4.xml`);
    expect(links.inlineXbrlViewer).toBeNull();
  });

  test('gives a plain .htm and a .pdf no raw XML link', () => {
    expect(buildLinks(CIK, '0000320193-26-000026', 'aapl-20260926.htm', true).rawXml).toBeNull();
    const pdf = buildLinks(CIK, '0000000000-25-012345', 'filename1.pdf', false);
    expect(pdf.document).toBe(`${folderOf(CIK, '0000000000-25-012345')}/filename1.pdf`);
    expect(pdf.rawXml).toBeNull();
  });

  test('gives no raw XML link to a file merely named xsl, outside an xsl folder', () => {
    expect(buildLinks(CIK, '0000320193-26-000026', 'xslnotes.htm', false).rawXml).toBeNull();
  });
});

describe('toFiling', () => {
  test('turns the 10-K row into the example response data of "Data normalization"', () => {
    const folder = folderOf(CIK, '0000320193-26-000026');
    expect(toFiling(CIK, rowOf('10-K'))).toEqual({
      accessionNumber: '0000320193-26-000026',
      cik: CIK,
      form: '10-K',
      baseForm: '10-K',
      isAmendment: false,
      filingDate: '2026-11-03',
      reportDate: '2026-09-26',
      acceptedAt: '2026-11-03T13:05:15.000Z',
      act: '34',
      fileNumber: '001-36743',
      filmNumber: '261514222',
      items: [],
      sizeBytes: 10902198,
      isXbrl: true,
      isInlineXbrl: true,
      primaryDocument: 'aapl-20260926.htm',
      description: '10-K',
      links: {
        document: `${folder}/aapl-20260926.htm`,
        index: `${folder}/0000320193-26-000026-index.htm`,
        folderJson: `${folder}/index.json`,
        inlineXbrlViewer: 'https://www.sec.gov/ix?doc=/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm',
        rawXml: null,
      },
    });
  });

  test('splits the 8-K items into an array', () => {
    expect(toFiling(CIK, rowOf('8-K')).items).toEqual(['2.02', '9.01']);
  });

  test('turns every empty string into null and empty items into []', () => {
    const filing = toFiling(CIK, { ...rowOf('UPLOAD'), primaryDocDescription: '' });
    expect(filing.reportDate).toBeNull();
    expect(filing.act).toBeNull();
    expect(filing.fileNumber).toBeNull();
    expect(filing.filmNumber).toBeNull();
    expect(filing.description).toBeNull();
    expect(filing.items).toEqual([]);
  });

  test('keeps an amendment under its base form', () => {
    const filing = toFiling(CIK, { ...rowOf('10-K'), form: '10-K/A' });
    expect(filing).toMatchObject({ form: '10-K/A', baseForm: '10-K', isAmendment: true });
  });

  test('ignores core_type, so a non-tracked form tagged XBRL keeps its own base form', () => {
    const filing = toFiling(CIK, { ...rowOf('424B2'), core_type: 'XBRL' });
    expect(filing.baseForm).toBe('424B2');
  });

  test('gives a result the strict Filing schema accepts, with no EDGAR-only field', () => {
    for (const row of ROWS) {
      const filing = toFiling(CIK, row);
      expect(Filing.safeParse(filing).success).toBe(true);
      expect(Object.keys(filing)).not.toContain('core_type');
    }
  });

  test('throws a ZodError on an accession number off the ##########-##-###### shape', () => {
    expect(() => toFiling(CIK, { ...rowOf('10-K'), accessionNumber: '000032019326000026' })).toThrow(ZodError);
  });

  test('throws a ZodError on a size that is not an integer', () => {
    expect(() => toFiling(CIK, { ...rowOf('10-K'), size: 1.5 })).toThrow(ZodError);
  });
});

describe('the parsers together', () => {
  test('a document gives the last year of filings, counted by base form', () => {
    const header = SubmissionsHeader.parse(DOCUMENT);
    const filings = withinRetention(columnsToRows(header.filings.recent), NOW).map((r) => toFiling(CIK, r));
    expect(filings.map((f) => f.baseForm)).toEqual(['10-K', '8-K', '4', '424B2']);
    expect(filings.every((f) => f.cik === Number(header.cik))).toBe(true);
  });
});
