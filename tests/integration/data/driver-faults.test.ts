import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { faultCode } from '../../../src/data/driver-faults.ts';
import { thrownBy } from '../../data/rolled-back.ts';
import { databaseUrlFor, SCRATCH_PREFIX, serverUrlOf } from '../../support/test-db.ts';

describe('faultCode against a running server', () => {
  test('reads the code postgres-js gives a database that does not exist, bare and as drizzle wraps it', async () => {
    // Arrange: a database name nothing creates, on the server the integration tests use.
    const missing = `${SCRATCH_PREFIX}missing_${crypto.randomUUID().replaceAll('-', '')}`;
    const client = postgres(databaseUrlFor(serverUrlOf(), missing), { max: 1, onnotice: () => {} });

    // Act
    const bare = await thrownBy(() => client`select 1`);
    const wrapped = await thrownBy(() => drizzle(client).execute(sql`select 1`));
    await client.end();

    // Assert: Postgres's invalid_catalog_name.
    expect(faultCode(bare)).toBe('3D000');
    expect(faultCode(wrapped)).toBe('3D000');
  });
});
