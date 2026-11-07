import type { Db } from '../../../../../src/data/repositories/db.ts';

import { appConfig } from '../../../../../src/data/active.ts';

/** Writes `fail-good`, which stays committed when a later seed fails. */
export async function seed(db: Db): Promise<void> {
  await db.insert(appConfig).values({ key: 'fail-good', value: true })
    .onConflictDoNothing();
}
