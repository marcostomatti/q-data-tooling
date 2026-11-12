import { describe, expect, test } from 'bun:test';

import { Filing } from '../../src/entities/filing.ts';
import {
  columnsToRows,
  type FilingColumns,
  type RawRow,
  SubmissionsHeader,
  toFiling,
  withinRetention,
} from '../../src/sec/parse.ts';

/**
 * The parsers over `tests/fixtures/sec/aapl-five-rows.json`, a cut of Apple's real submissions
 * file holding one 10-K, 8-K, Form 4, 424B2 and UPLOAD row, in that order. Each case of "Edge
 * cases for test suite" in `setup-prompt.md` that `src/sec/parse.ts` owns is read off these
 * rows, not off rows written here, so a change in EDGAR's shape shows up as a red test.
 *
 * The other cases of that section belong to the seed, the repository and the flows: the
 * secondary ticker `AEMRF`, the company with no 10-K, the sync within the TTL and the page past
 * the last one. The one `cik_str` case that reaches the parsers is the padded `cik` string of
 * the header, which the cases below check against the integer `cik` that `toFiling` takes.
 */

/** Apple's CIK, unpadded, as the service keys it. */
const CIK = 320193;

/** The day the DoD's last-year cut is measured on. */
const NOW = new Date('2026-11-11T12:00:00.000Z');

const FIXTURE_URL = new URL('../fixtures/sec/aapl-five-rows.json', import.meta.url);

const raw: unknown = await Bun.file(FIXTURE_URL).json();
const header = SubmissionsHeader.parse(raw);
const ROWS: readonly RawRow[] = columnsToRows(header.filings.recent);

/** The fixture row of the given form. */
function rowOf(form: string): RawRow {
  const row = ROWS.find((r) => r.form === form);
  if (row === undefined) {
    throw new Error(`fixture has no ${form} row`);
  }
  return row;
}

/** The fixture's filing of the given form, as `toFiling` gives it. */
const filingOf = (form: string) => toFiling(CIK, rowOf(form));

/** The folder of one filing, keyed by CIK, as the "Link templates" table spells it. */
const folderOf = (accession: string) => `https://www.sec.gov/Archives/edgar/data/${CIK}/${accession.replaceAll('-', '')}`;

describe('the five-row fixture', () => {
  test('parses under the loose header schema and holds the five forms in order', () => {
    expect(ROWS.map((r) => r.form)).toEqual(['10-K', '8-K', '4', '424B2', 'UPLOAD']);
  });

  test('keeps the header cik as a ten-digit string, the integer cik of toFiling being its number', () => {
    expect(header.cik).toBe('0000320193');
    expect(Number(header.cik)).toBe(CIK);
    expect(typeof header.cik).toBe('string');
  });

  test('holds a null isXBRLNumeric, which EDGAR sends for an UPLOAD, and the parse still passes', () => {
    expect(rowOf('UPLOAD').isXBRLNumeric).toBeNull();
    expect(rowOf('10-K').isXBRLNumeric).toBe(1);
  });
});

describe('empty strings in the fixture rows', () => {
  test('an empty reportDate becomes null and a filled one stays', () => {
    expect(rowOf('424B2').reportDate).toBe('');
    expect(filingOf('424B2').reportDate).toBeNull();
    expect(filingOf('UPLOAD').reportDate).toBeNull();
    expect(filingOf('10-K').reportDate).toBe('2026-09-26');
  });

  test('an empty items becomes [] and a filled one is split', () => {
    expect(rowOf('10-K').items).toBe('');
    expect(filingOf('10-K').items).toEqual([]);
    expect(filingOf('8-K').items).toEqual(['8.01', '9.01']);
  });

  test('an empty act becomes null and a filled one stays', () => {
    expect(rowOf('4').act).toBe('');
    expect(filingOf('4').act).toBeNull();
    expect(filingOf('424B2').act).toBe('33');
  });

  test('an empty primaryDocDescription becomes a null description', () => {
    expect(rowOf('8-K').primaryDocDescription).toBe('');
    expect(filingOf('8-K').description).toBeNull();
    expect(filingOf('UPLOAD').description).toBeNull();
    expect(filingOf('4').description).toBe('FORM 4');
  });

  test('an empty fileNumber and filmNumber become null on the Form 4', () => {
    const filing = filingOf('4');
    expect(filing.fileNumber).toBeNull();
    expect(filing.filmNumber).toBeNull();
  });

  test('leaves no empty string in any normalized filing', () => {
    for (const row of ROWS) {
      const values = Object.values(toFiling(CIK, row)).filter((v) => typeof v === 'string');
      expect(values).not.toContain('');
    }
  });
});

describe('filing agent accessions in the fixture', () => {
  test.each(['8-K', '4', '424B2'])('the %s link folder uses the company CIK, not the accession prefix', (form) => {
    const filing = filingOf(form);
    const prefix = Number(filing.accessionNumber.slice(0, 10));
    expect(prefix).not.toBe(CIK);
    expect(filing.links.document.startsWith(`${folderOf(filing.accessionNumber)}/`)).toBe(true);
    expect(filing.links.index).toBe(`${folderOf(filing.accessionNumber)}/${filing.accessionNumber}-index.htm`);
    expect(filing.links.folderJson).toBe(`${folderOf(filing.accessionNumber)}/index.json`);
    expect(filing.links.document).not.toContain(`/data/${prefix}/`);
  });
});

describe('the primary document of each fixture row', () => {
  test('the Form 4 under an xsl folder gets a rawXml without that folder', () => {
    const filing = filingOf('4');
    expect(rowOf('4').primaryDocument).toBe('xslF345X06/form4.xml');
    expect(filing.links.document).toBe(`${folderOf(filing.accessionNumber)}/xslF345X06/form4.xml`);
    expect(filing.links.rawXml).toBe(`${folderOf(filing.accessionNumber)}/form4.xml`);
    expect(filing.links.inlineXbrlViewer).toBeNull();
  });

  test.each(['10-K', '8-K', '424B2'])('the plain .htm of the %s gets a null rawXml', (form) => {
    expect(rowOf(form).primaryDocument).toMatch(/\.htm$/);
    expect(filingOf(form).links.rawXml).toBeNull();
  });

  test('the UPLOAD with a .pdf primary document still links to the pdf, with no rawXml or viewer', () => {
    const filing = filingOf('UPLOAD');
    expect(filing.primaryDocument).toBe('filename1.pdf');
    expect(filing.links).toEqual({
      document: `${folderOf(filing.accessionNumber)}/filename1.pdf`,
      index: `${folderOf(filing.accessionNumber)}/${filing.accessionNumber}-index.htm`,
      folderJson: `${folderOf(filing.accessionNumber)}/index.json`,
      inlineXbrlViewer: null,
      rawXml: null,
    });
  });

  test('an inline XBRL row gets a viewer link on the unpadded CIK path', () => {
    const filing = filingOf('10-K');
    expect(filing.links.inlineXbrlViewer).toBe(
      'https://www.sec.gov/ix?doc=/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm',
    );
  });
});

describe('core_type in the fixture rows', () => {
  test('is "XBRL" on the 10-K and 8-K and is ignored: only form decides the base form', () => {
    expect(rowOf('10-K').core_type).toBe('XBRL');
    expect(rowOf('8-K').core_type).toBe('XBRL');
    expect(filingOf('10-K').baseForm).toBe('10-K');
    expect(filingOf('8-K').baseForm).toBe('8-K');
  });

  test('a row tagged XBRL under another form keeps that form as its base form', () => {
    const filing = toFiling(CIK, { ...rowOf('UPLOAD'), core_type: 'XBRL' });
    expect(filing.baseForm).toBe('UPLOAD');
  });

  test('a 10-K tagged with another core_type is still a 10-K', () => {
    const filing = toFiling(CIK, { ...rowOf('10-K'), core_type: 'LETTER' });
    expect(filing.baseForm).toBe('10-K');
  });

  test('reaches no normalized filing, which the strict Filing schema would refuse', () => {
    for (const row of ROWS) {
      const filing = toFiling(CIK, row);
      expect(Object.keys(filing)).not.toContain('core_type');
      expect(Object.keys(filing)).not.toContain('isXBRLNumeric');
      expect(Filing.safeParse(filing).success).toBe(true);
    }
  });
});

describe('amendments in the fixture rows', () => {
  test('the 10-K row as 10-K/A is the 10-K base form with isAmendment true', () => {
    const filing = toFiling(CIK, { ...rowOf('10-K'), form: '10-K/A' });
    expect(filing).toMatchObject({ form: '10-K/A', baseForm: '10-K', isAmendment: true });
  });

  test('the fixture\'s own rows are no amendments', () => {
    expect(ROWS.map((r) => toFiling(CIK, r).isAmendment)).toEqual([false, false, false, false, false]);
  });
});

describe('column arrays of different lengths in the fixture', () => {
  const columns = (): FilingColumns => header.filings.recent;

  test('make the ingest throw, naming the short column', () => {
    const short = { ...columns(), size: columns().size.slice(1) };
    expect(() => columnsToRows(short)).toThrow('EDGAR columns misaligned: size');
  });

  test('make the ingest throw, naming the long column', () => {
    const long = { ...columns(), form: [...columns().form, '10-Q'] };
    expect(() => columnsToRows(long)).toThrow('EDGAR columns misaligned: form');
  });

  test('make the ingest throw when the document is parsed whole, since the header schema cannot see it', () => {
    const skewed = {
      ...(raw as Record<string, unknown>),
      filings: {
        ...header.filings,
        recent: { ...columns(), primaryDocument: columns().primaryDocument.slice(0, 4) },
      },
    };
    const parsed = SubmissionsHeader.parse(skewed);
    expect(() => columnsToRows(parsed.filings.recent)).toThrow('EDGAR columns misaligned: primaryDocument');
  });

  test('emit no partial rows: the throw happens before any row is built', () => {
    const short = { ...columns(), accessionNumber: columns().accessionNumber.slice(0, 1) };
    expect(() => columnsToRows(short)).toThrow(/^EDGAR columns misaligned: /);
  });
});

describe('the last-year cut over the fixture', () => {
  test('keeps the four rows filed in the year before now and drops the 2024 UPLOAD', () => {
    const kept = withinRetention(ROWS, NOW);
    expect(kept.map((r) => r.form)).toEqual(['10-K', '8-K', '4', '424B2']);
  });

  test('every kept row normalizes to a Filing the strict schema accepts', () => {
    const filings = withinRetention(ROWS, NOW).map((r) => toFiling(CIK, r));
    expect(filings.map((f) => f.baseForm)).toEqual(['10-K', '8-K', '4', '424B2']);
    expect(filings.every((f) => Filing.safeParse(f).success)).toBe(true);
  });
});
