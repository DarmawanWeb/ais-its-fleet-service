/** SQLSTATE of a unique constraint violation. */
export const PG_UNIQUE_VIOLATION = '23505';

/** SQLSTATE of a foreign key violation. */
export const PG_FOREIGN_KEY_VIOLATION = '23503';

/** The PostgreSQL error fields this service looks at. */
export interface PgErrorFields {
  readonly code: string;
  readonly constraint: string | undefined;
}

/**
 * The driver error behind `error` (drizzle wraps driver errors in
 * `DrizzleQueryError`, so the causes are followed), or `undefined`.
 */
export function pgErrorOf(error: unknown): PgErrorFields | undefined {
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 8; depth += 1) {
    if ('code' in current && typeof current.code === 'string') {
      const constraint =
        'constraint' in current && typeof current.constraint === 'string'
          ? current.constraint
          : undefined;
      return { code: current.code, constraint };
    }
    current = current.cause;
  }
  return undefined;
}

/**
 * `true` when `error` (or one of its causes) is a PostgreSQL unique
 * violation, optionally of the named constraint.
 *
 * @example
 * catch (error) {
 *   if (isUniqueViolation(error, 'vessels_mmsi_key')) throw new MmsiTakenError(mmsi, error);
 *   throw error;
 * }
 */
export function isUniqueViolation(
  error: unknown,
  constraint?: string,
): boolean {
  const pg = pgErrorOf(error);
  return (
    pg?.code === PG_UNIQUE_VIOLATION &&
    (constraint === undefined || pg.constraint === constraint)
  );
}

/** `true` when `error` (or one of its causes) is a PostgreSQL foreign key violation. */
export function isForeignKeyViolation(error: unknown): boolean {
  return pgErrorOf(error)?.code === PG_FOREIGN_KEY_VIOLATION;
}
