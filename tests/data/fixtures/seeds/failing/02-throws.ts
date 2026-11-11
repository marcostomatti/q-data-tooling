import type { Db } from '../../../../../src/data/repositories/db.ts';

import { appConfig } from '../../../../../src/data/active.ts';

/** Writes `fail-partial` and then throws, so the write must roll back. */
export async function seed(db: Db): Promise<void> {
  await db.insert(appConfig).values({ key: 'fail-partial', value: true });
  throw new Error('seed fixture fails on purpose');
}
