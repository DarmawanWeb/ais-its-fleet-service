import type { Pool } from '@darmawanweb/ais-its-nest/db';
import { describe, expect, it } from 'vitest';

import { inTransaction, TRANSACTION_RETRIES } from './database.js';

/** A driver error wrapped the way drizzle wraps it (`DrizzleQueryError`). */
function drizzleError(code: string): Error {
  return new Error('Failed query: UPDATE …', {
    cause: Object.assign(new Error('deadlock detected'), {
      code,
      severity: 'ERROR',
    }),
  });
}

/** A pool whose clients record the statements they receive. */
function recordingPool(): { pool: Pool; statements: string[] } {
  const statements: string[] = [];
  const client = {
    query: (text: string) => {
      statements.push(text);
      return Promise.resolve({ rows: [], rowCount: 0 });
    },
    release: () => undefined,
  };
  return {
    pool: { connect: () => Promise.resolve(client) } as unknown as Pool,
    statements,
  };
}

// Regression of the service's use of the kit's `withTransaction({ retries })`
// (its retry loop of 0.1 is gone): a deadlock inside a drizzle query must be
// re-run, other errors must not.
describe('inTransaction', () => {
  it('re-runs a transaction that lost a deadlock inside a drizzle query', async () => {
    const { pool, statements } = recordingPool();
    let attempts = 0;
    const result = await inTransaction(pool, () => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(drizzleError('40P01'))
        : Promise.resolve('committed');
    });
    expect(result).toBe('committed');
    expect(attempts).toBe(2);
    expect(statements).toEqual(['BEGIN', 'ROLLBACK', 'BEGIN', 'COMMIT']);
  });

  it('gives up after the retries and never retries other errors', async () => {
    const { pool } = recordingPool();
    let attempts = 0;
    await expect(
      inTransaction(pool, () => {
        attempts += 1;
        return Promise.reject(drizzleError('40001'));
      }),
    ).rejects.toThrow('Failed query');
    expect(attempts).toBe(TRANSACTION_RETRIES + 1);

    attempts = 0;
    await expect(
      inTransaction(pool, () => {
        attempts += 1;
        return Promise.reject(drizzleError('23505'));
      }),
    ).rejects.toThrow('Failed query');
    expect(attempts).toBe(1);
  });
});
