import { describe, expect, test } from 'bun:test';

import { Filing, FilingLinks, TrackedForm } from '../../src/entities/filing.ts';

/** The folder of the example filing in "Data normalization". */
const folder = 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000026';

const links = {
  document: `${folder}/aapl-20260926.htm`,
  index: `${folder}/0000320193-26-000026-index.htm`,
  folderJson: `${folder}/index.json`,
  inlineXbrlViewer: 'https://www.sec.gov/ix?doc=/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm',
  rawXml: null,
};

/** The example response data of "Data normalization". */
const filing = {
  accessionNumber: '0000320193-26-000026',
  cik: 320193,
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
  links,
};

describe('TrackedForm', () => {
  test('accepts the three base forms', () => {
    expect(TrackedForm.options).toEqual(['10-K', '10-Q', '8-K']);
    for (const form of TrackedForm.options) {
      expect(TrackedForm.parse(form)).toBe(form);
    }
  });

  test('refuses an amendment, another form and lower case', () => {
    expect(TrackedForm.safeParse('10-K/A').success).toBe(false);
    expect(TrackedForm.safeParse('S-1').success).toBe(false);
    expect(TrackedForm.safeParse('10-k').success).toBe(false);
  });
});

describe('FilingLinks', () => {
  test('accepts the links with a null XBRL link', () => {
    expect(FilingLinks.parse(links)).toEqual(links);
  });

  test('refuses a link that is not a URL', () => {
    expect(FilingLinks.safeParse({ ...links, document: 'aapl-20260926.htm' }).success).toBe(false);
  });

  test('refuses a null document link and a stray field', () => {
    expect(FilingLinks.safeParse({ ...links, document: null }).success).toBe(false);
    expect(FilingLinks.safeParse({ ...links, xbrlZip: `${folder}/x.zip` }).success).toBe(false);
  });
});

describe('Filing', () => {
  test('accepts the example response data', () => {
    expect(Filing.parse(filing)).toEqual(filing);
  });

  test('accepts an amendment with its form kept verbatim and 8-K items', () => {
    const amendment = { ...filing, form: '8-K/A', baseForm: '8-K', isAmendment: true, items: ['8.01', '9.01'] };
    expect(Filing.parse(amendment)).toEqual(amendment);
  });

  test('accepts null in every nullable field', () => {
    const sparse = { ...filing, reportDate: null, act: null, fileNumber: null, filmNumber: null, description: null };
    expect(Filing.parse(sparse)).toEqual(sparse);
  });

  test('refuses a malformed accession number', () => {
    expect(Filing.safeParse({ ...filing, accessionNumber: '000032019326000026' }).success).toBe(false);
    expect(Filing.safeParse({ ...filing, accessionNumber: '320193-26-000026' }).success).toBe(false);
  });

  test('refuses a 0/1 flag where a boolean belongs', () => {
    expect(Filing.safeParse({ ...filing, isXbrl: 1 }).success).toBe(false);
  });

  test('refuses items as one comma-joined string', () => {
    expect(Filing.safeParse({ ...filing, items: '8.01,9.01' }).success).toBe(false);
  });

  test('refuses a stray field on the filing and on its links', () => {
    expect(Filing.safeParse({ ...filing, stray: true }).success).toBe(false);
    expect(Filing.safeParse({ ...filing, links: { ...links, stray: true } }).success).toBe(false);
  });
});
