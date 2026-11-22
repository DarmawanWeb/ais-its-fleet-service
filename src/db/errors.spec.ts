import { describe, expect, it } from 'vitest';

import {
  isForeignKeyViolation,
  isUniqueViolation,
  notNullViolationColumn,
  PG_FOREIGN_KEY_VIOLATION,
  PG_NOT_NULL_VIOLATION,
  PG_UNIQUE_VIOLATION,
  pgErrorOf,
} from './errors.js';

/** A driver error as `pg` throws it. */
function driverError(
  code: string,
  constraint?: string,
  column?: string,
): Error {
  return Object.assign(new Error('duplicate key value'), {
    code,
    constraint,
    column,
  });
}

describe('isUniqueViolation', () => {
  it('recognizes a unique violation of the driver', () => {
    expect(isUniqueViolation(driverError(PG_UNIQUE_VIOLATION, 'x_key'))).toBe(
      true,
    );
  });

  it('looks through wrapping errors (drizzle DrizzleQueryError)', () => {
    const wrapped = new Error('Failed query', {
      cause: driverError(PG_UNIQUE_VIOLATION, 'vessels_mmsi_key'),
    });
    expect(isUniqueViolation(wrapped, 'vessels_mmsi_key')).toBe(true);
  });

  it('checks the constraint name when given', () => {
    expect(
      isUniqueViolation(driverError(PG_UNIQUE_VIOLATION, 'a_key'), 'b_key'),
    ).toBe(false);
  });

  it('ignores other errors and non-errors', () => {
    expect(isUniqueViolation(driverError('23503', 'fk'))).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation({ code: PG_UNIQUE_VIOLATION })).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});

describe('isForeignKeyViolation / pgErrorOf', () => {
  it('recognizes a foreign key violation behind a wrapper', () => {
    const wrapped = new Error('Failed query', {
      cause: driverError(PG_FOREIGN_KEY_VIOLATION, 'vessels_fuel_id_fkey'),
    });
    expect(isForeignKeyViolation(wrapped)).toBe(true);
    expect(pgErrorOf(wrapped)).toEqual({
      code: PG_FOREIGN_KEY_VIOLATION,
      constraint: 'vessels_fuel_id_fkey',
      column: undefined,
    });
  });

  it('returns undefined without a driver error', () => {
    expect(isForeignKeyViolation(new Error('boom'))).toBe(false);
    expect(pgErrorOf('text')).toBeUndefined();
  });
});

describe('notNullViolationColumn', () => {
  it('names the column of a NOT NULL violation behind a wrapper', () => {
    const wrapped = new Error('Failed query', {
      cause: driverError(PG_NOT_NULL_VIOLATION, undefined, 'name'),
    });
    expect(notNullViolationColumn(wrapped)).toBe('name');
  });

  it('ignores other errors', () => {
    expect(
      notNullViolationColumn(driverError(PG_UNIQUE_VIOLATION, 'x', 'name')),
    ).toBeUndefined();
    expect(notNullViolationColumn(new Error('boom'))).toBeUndefined();
  });
});
