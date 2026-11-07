import type { Db } from '../../../../../src/data/repositories/db.ts';

import { eq } from 'drizzle-orm';

import { appConfig } from '../../../../../src/data/active.ts';

/** Writes `seed-second`, holding whether `seed-first` was already there, so a test sees the order. */
export async function seed(db: Db): Promise<void> {
  const first = await db.select().from(appConfig)
    .where(eq(appConfig.key, 'seed-first'));
  await db.insert(appConfig).values({ key: 'seed-second', value: first.length === 1 })
    .onConflictDoNothing();
}
