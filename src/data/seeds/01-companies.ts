/**
 * The companies seed: loads the SEC ticker list, `data/company_tickers.json` beside this file,
 * into `companies` and `company_tickers`.
 *
 * The file is validated with {@link TickerFile} before anything is written. Each CIK becomes one
 * company, whose primary ticker and name are those of the CIK's first entry in the file, in key
 * order. Every ticker becomes a `company_tickers` row that points at its CIK. Rows go in chunks of
 * {@link SEED_CHUNK_SIZE} with `onConflictDoNothing`, because the seed runner runs every seed on
 * every `db:seed`: a second run writes nothing, and it leaves a company's `selected` flag and
 * synced header fields as they are.
 *
 * @module
 */

import type { Db } from '../repositories/db.ts';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { toCik10, type CompanyTicker } from '../../entities/company.ts';
import { companies, companyTickers } from '../active.ts';

/** One entry of the SEC ticker file. */
export const TickerEntry = z.object({
  /** The raw CIK, unpadded, as a number: `320193`. */
  cik_str: z.number().int(),
  /** The ticker as the SEC spells it: `AAPL`. */
  ticker: z.string(),
  /** The company's name: `Apple Inc.`. */
  title: z.string(),
});

/** An entry of the SEC ticker file as {@link TickerEntry} parses it. */
export type TickerEntry = z.infer<typeof TickerEntry>;

/** The SEC ticker file: entries keyed `"0"`, `"1"`, ..., in the SEC's order. */
export const TickerFile = z.record(z.string(), TickerEntry);

/** The SEC ticker file as {@link TickerFile} parses it. */
export type TickerFile = z.infer<typeof TickerFile>;

/** The ticker file the seed reads by default. */
export const TICKERS_FILE = join(import.meta.dir, 'data', 'company_tickers.json');

/** How many rows one insert statement carries. */
export const SEED_CHUNK_SIZE = 500;

/** A `companies` row as the seed writes it: the header fields keep their column defaults. */
export type SeedCompany = Pick<typeof companies.$inferInsert, 'cik' | 'cik10' | 'ticker' | 'name'>;

/** The rows a ticker file seeds, companies first, since every ticker row points at one. */
export interface SeedRows {
  readonly companies: readonly SeedCompany[]
  readonly tickers: readonly CompanyTicker[]
}

/**
 * The rows a parsed ticker file seeds. The first entry of a CIK, in the file's key order, gives
 * the company its primary ticker and name; a ticker listed twice keeps its first CIK.
 *
 * @param file - The ticker file, parsed with {@link TickerFile}.
 * @returns One company per CIK and one ticker row per distinct ticker, in file order.
 */
export function toSeedRows(file: TickerFile): SeedRows {
  const byCik = new Map<number, SeedCompany>();
  const byTicker = new Map<string, CompanyTicker>();
  for (const entry of Object.values(file)) {
    if (!byCik.has(entry.cik_str)) {
      byCik.set(entry.cik_str, { cik: entry.cik_str, cik10: toCik10(entry.cik_str), ticker: entry.ticker, name: entry.title });
    }
    if (!byTicker.has(entry.ticker)) byTicker.set(entry.ticker, { ticker: entry.ticker, cik: entry.cik_str });
  }
  return { companies: [...byCik.values()], tickers: [...byTicker.values()] };
}

/**
 * Splits `rows` into consecutive chunks of at most `size` rows.
 *
 * @param rows - The rows to split.
 * @param size - The largest chunk; a positive integer.
 * @returns The chunks, in order; empty when `rows` is.
 * @throws {RangeError} When `size` is not a positive integer.
 */
export function chunked<T>(rows: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`chunk size ${size} is not a positive integer`);
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size));
}

/**
 * Writes the companies and tickers of a parsed ticker file, in chunks of
 * {@link SEED_CHUNK_SIZE}, skipping every row whose key is already stored.
 *
 * @param db - The client or open transaction to write through.
 * @param file - The ticker file, parsed with {@link TickerFile}.
 * @returns Nothing; the rows are written.
 * @throws When the database refuses an insert; the seed runner's transaction then rolls it back.
 */
export async function seedTickers(db: Db, file: TickerFile): Promise<void> {
  const rows = toSeedRows(file);
  for (const chunk of chunked(rows.companies, SEED_CHUNK_SIZE)) {
    await db.insert(companies).values(chunk)
      .onConflictDoNothing();
  }
  for (const chunk of chunked(rows.tickers, SEED_CHUNK_SIZE)) {
    await db.insert(companyTickers).values(chunk)
      .onConflictDoNothing();
  }
}

/**
 * Reads and validates the ticker file, then seeds it with {@link seedTickers}.
 *
 * @param db - The client or open transaction the seed runner passes.
 * @param path - The ticker file. Defaults to {@link TICKERS_FILE}.
 * @returns Nothing; the rows are written.
 * @throws {SyntaxError} When the file is not JSON; nothing is written.
 * @throws {z.ZodError} When the file does not match {@link TickerFile}; nothing is written.
 * @throws When the file cannot be read, or the database refuses an insert.
 */
export async function seed(db: Db, path: string = TICKERS_FILE): Promise<void> {
  const file = TickerFile.parse(JSON.parse(await readFile(path, 'utf8')));
  await seedTickers(db, file);
}
