import type { Db } from '../../../../../src/data/repositories/db.ts';

import { appConfig } from '../../../../../src/data/active.ts';

/** Writes `seed-first`; idempotent on its key, as a seed must be. */
export async function seed(db: Db): Promise<void> {
  await db.insert(appConfig).values({ key: 'seed-first', value: true })
    .onConflictDoNothing();
}
