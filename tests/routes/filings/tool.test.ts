import { describe, expect, test } from 'bun:test';

import { FilingListInput, SummaryInput } from '../../../src/routes/filings/contract.ts';
import { filingListTool, filingSummaryTool, filingTools } from '../../../src/routes/filings/tool.ts';
import { connectTools, untouchableDb } from '../../support/tool-harness.ts';

describe('the filing_list tool', () => {
  test('is defined on the shared schema object and marked read-only', () => {
    expect(filingListTool.name).toBe('filing_list');
    expect(filingListTool.input).toBe(FilingListInput);
    expect(filingListTool.annotations?.readOnlyHint).toBe(true);
  });

  test('a call with an unknown form or without a ticker is refused', async () => {
    const tools = await connectTools(filingTools, untouchableDb());
    expect((await tools.call('filing_list', { ticker: 'AAPL', form: 'S-1' })).failed).toBe(true);
    expect((await tools.call('filing_list', {})).failed).toBe(true);
  });
});

describe('the filing_summary tool', () => {
  test('is defined on the shared schema object and marked read-only', () => {
    expect(filingSummaryTool.name).toBe('filing_summary');
    expect(filingSummaryTool.input).toBe(SummaryInput);
    expect(filingSummaryTool.annotations?.readOnlyHint).toBe(true);
  });

  test('a call with a stray argument is refused', async () => {
    const tools = await connectTools(filingTools, untouchableDb());
    const outcome = await tools.call('filing_summary', { extra: 1 });
    expect(outcome.failed).toBe(true);
  });
});
