import { databaseErrorInfo, PG_SQLSTATES } from '@darmawanweb/ais-its-nest/db';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { catchError, type Observable, throwError } from 'rxjs';

import { invalidField } from '../../errors.js';

/** `annual_voyage_percentage` → `annualVoyagePercentage`. */
export function camelCaseColumn(column: string): string {
  return column.replace(/_([a-z0-9])/g, (_match, next: string) =>
    next.toUpperCase(),
  );
}

/**
 * The column of a PostgreSQL NOT NULL violation behind `error` (`null` sent
 * for a required column; drizzle's wrapper is looked through), or
 * `undefined` for any other error.
 */
export function notNullViolationColumn(error: unknown): string | undefined {
  const info = databaseErrorInfo(error);
  return info?.code === PG_SQLSTATES.NOT_NULL_VIOLATION
    ? info.column
    : undefined;
}

/**
 * Second safeguard behind DTO validation (`IsOptionalNotNull`, `PatchType`):
 * a PostgreSQL NOT NULL violation (`null` sent for a required column) is
 * answered `400 VALIDATION_FAILED` on the column's field instead of `500`
 * (spec §5). It is logged as a warning, because it means a DTO lets `null`
 * through where it should not.
 */
@Injectable()
export class NotNullViolationInterceptor implements NestInterceptor {
  private readonly logger = new Logger('NotNullViolation');

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        const column = notNullViolationColumn(error);
        if (column === undefined) return throwError(() => error);
        const field = camelCaseColumn(column);
        this.logger.warn(
          `NOT NULL violation on column ${column} answered as 400: a DTO lets null through for ${field}`,
        );
        return throwError(() =>
          invalidField(field, `${field} must not be null`, 'isNotNull'),
        );
      }),
    );
  }
}
