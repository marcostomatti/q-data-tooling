import { describe, expect, test } from 'bun:test';

import { Company } from '../../../src/entities/company.ts';
import { Filing } from '../../../src/entities/filing.ts';
import { FIXED_COMPANIES, FIXED_FILINGS } from '../fixtures.ts';

describe('the route fixtures', () => {
  test('hold companies and filings that each pass their entity', () => {
    expect(FIXED_COMPANIES.length).toBeGreaterThan(0);
    expect(FIXED_FILINGS.length).toBeGreaterThan(0);
    for (const company of FIXED_COMPANIES) expect(Company.parse(company)).toEqual(company);
    for (const filing of FIXED_FILINGS) expect(Filing.parse(filing)).toEqual(filing);
  });
});
