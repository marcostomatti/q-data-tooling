import { describe, expect, test } from 'bun:test';

import { readSecUserAgent } from '../../src/sec/config.ts';
import { buildLinks } from '../../src/sec/parse.ts';

/**
 * Live probe: SEC answers `HEAD` with 200 for the document, index and inline XBRL viewer links
 * built for Apple's 10-K `0000320193-26-000026`. Off unless `SEC_LIVE=1`, and then reported as
 * skipped, never as passed. It needs `SEC_USER_AGENT` (app name and contact email) in the
 * environment, since SEC answers 403 without one.
 */

const LIVE = process.env['SEC_LIVE'] === '1';
const CIK = 320193;
const ACCESSION = '0000320193-26-000026';
const PRIMARY_DOCUMENT = 'aapl-20260926.htm';
const OK = 200;
const TIMEOUT_MS = 30_000;

const links = buildLinks(CIK, ACCESSION, PRIMARY_DOCUMENT, true);

describe('SEC live links', () => {
  test.skipIf(!LIVE)('answers HEAD 200 for the document, index and ix viewer links', async () => {
    // Arrange
    const userAgent = readSecUserAgent(process.env);
    const urls = [links.document, links.index, links.inlineXbrlViewer];

    // Act
    const statuses: { url: string | null, status: number }[] = [];
    for (const url of urls) {
      if (url === null) throw new Error('the viewer link is null for an inline XBRL filing');
      const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': userAgent } });
      statuses.push({ url, status: res.status });
    }

    // Assert
    expect(statuses.map((s) => s.status)).toEqual([OK, OK, OK]);
  }, TIMEOUT_MS);
});
